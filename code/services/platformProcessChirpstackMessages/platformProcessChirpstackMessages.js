/**
 * Type: Micro Service
 * Description: A short-lived service which is expected to complete within a fixed period of time.
 * @param {CbServer.BasicReq} req
 * @param {string} req.systemKey
 * @param {string} req.systemSecret
 * @param {string} req.userEmail
 * @param {string} req.userid
 * @param {string} req.userToken
 * @param {boolean} req.isLogging
 * @param {[id: string]} req.params
 * @param {CbServer.Resp} resp
 */

function platformProcessChirpstackMessages(req, resp) {
    var count = 0;
    var Secret = ClearBladeAsync.Secret();
    var loraClient; 
    var cbClient;

    log("service starting");

    function fetchAppIdFromCustomSettings() {
        return new Promise(function (resolve, reject) {
            var query = ClearBlade.Query({ collectionName: "custom_settings" });
            query.equalTo("id", "application_id"); 
            query.fetch(function (err, data) {
                if (err) {
                    log("Error fetching application ID: " + JSON.stringify(data));
                    reject("Unable to fetch application ID: " + JSON.stringify(data));
                } else if (data.DATA.length === 0) {
                    reject("No application ID found in custom settings.");
                } else {
                    var appId = JSON.parse(data.DATA[0].config).app; // Retrieve the app ID from the config field
                    log("Fetched application ID: " + appId);
                    resolve(appId);
                }
            });
        });
    }

    Promise.all([Secret.read("Chirpstack_CA_Cert"), Secret.read("Chirpstack_Client_Cert"), Secret.read("Chirpstack_Client_Key"), fetchAppIdFromCustomSettings()])
        .then(function (results) {
            var certs = results.slice(0, 3);
            var appId = results[3];

            var radLoRaOptions = {
                address: "lns1.rad.com",
                port: 7883,
                use_tls: true,
                tls_config: {
                    ca_cert: certs[0],
                    client_cert: certs[1],
                    client_key: certs[2]
                }
            };

            try {
                loraClient = new MQTT.Client(radLoRaOptions);
                log("connected to lora client");
            } catch (e) {
                resp.error("failed to init lora client: " + e);
            }

            try {
                cbClient = new MQTT.Client();
                log("connected to cb client");
            } catch (e) {
                resp.error("failed to init cb client: " + e);
            }

            const LORA_UPLINK_TOPIC = "$share/chirpstacksensor/application/" + appId + "/device/+/event/up";

            loraClient.subscribe(LORA_UPLINK_TOPIC, function (topic, msg) {
                log("topic: " + topic);
                log("raw message: " + JSON.stringify(msg));
                processMessage(msg, topic);
            }).catch(function (reason) {
                resp.error("failed to subscribe: " + reason.message);
            });

            loraClient.subscribe("$share/chirpstackgateway/us915_1/gateway/647fdafffe01ef0a/state", function (topic, msg) {
                log("gateway topic: " + topic);
                log("gateway raw message: " + JSON.stringify(msg));
                var payload = new TextDecoder("utf-8").decode(msg.payload_bytes);
                log(JSON.stringify(payload));
            }).catch(function (reason) {
                resp.error("failed to subscribe to gateway topic: " + reason.message);
            });
        })
        .catch(function (reason) {
            resp.error("failed to retrieve certs or application ID: " + reason);
        });

    function processMessage(msg) {
        try {
            var payload = new TextDecoder("utf-8").decode(msg.payload_bytes);
            log(JSON.stringify(payload));
            msg = JSON.parse(payload);
            log("keys are " + Object.keys(msg));
            var device = msg.deviceInfo.devEui;
            log("device data is: ", msg.data);
            log("DEVICE is: ", device);
            var keys = Object.keys(msg);

            var assetUpdateMessage = {
                id: msg.deviceInfo.devEui, // ID of the unique asset
                type: msg.deviceInfo.deviceProfileName, // Type of Asset to update, ex: "EM-300-TH"
                custom_data: {
                    Reporting: true
                },
                group_ids: ["default"]
            };

            var gatewayUpdateMessage = {
                id: "647fdafffe01ef0a", // TODO: map gateway ID from payload
                type: "gateway",
                custom_data: {
                    Reporting: true
                },
                group_ids: ["default"]
            };

            var attributes = Object.keys(msg.object); // this field contains sensor data
            for (x = 0; x < attributes.length; x++) {
                assetUpdateMessage.custom_data[attributes[x]] = msg.object[attributes[x]];
            }

            // Custom processing based on device profile name
            if (msg.deviceInfo.deviceProfileName.includes("WS301")) {
                assetUpdateMessage.type = "WS301";
                assetUpdateMessage.custom_data.doorOpen = assetUpdateMessage.custom_data.magnet_status !== "close";
                assetUpdateMessage.custom_data.uninstalled = assetUpdateMessage.custom_data.tamper_status === "uninstalled";
            } else if (msg.deviceInfo.deviceProfileName.includes("WS202")) {
                assetUpdateMessage.type = "WS202";
                assetUpdateMessage.custom_data.daylight = assetUpdateMessage.custom_data.daylight === "light";
                assetUpdateMessage.custom_data.motion = assetUpdateMessage.custom_data.pir === "trigger";
            } else if (msg.deviceInfo.deviceProfileName.includes("WS303")) {
                assetUpdateMessage.type = "WS303";
                assetUpdateMessage.custom_data.leak_detected = assetUpdateMessage.custom_data.leakage_status !== "normal";
            } else if (msg.deviceInfo.deviceProfileName.includes("WS101")) {
                assetUpdateMessage.type = "WS101";
                if (assetUpdateMessage.custom_data.press === "short" || assetUpdateMessage.custom_data.press === "double") {
                    assetUpdateMessage.custom_data.button_pushed = true;
                    log("Publishing this for button: ", JSON.stringify(assetUpdateMessage));
                    cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage));
                    cbClient.publish("_monitor/asset/default/data", JSON.stringify(gatewayUpdateMessage));
                    setTimeout(function () {
                        assetUpdateMessage.last_updated = new Date().toISOString();
                        assetUpdateMessage.custom_data.button_pushed = false;
                        log("Publishing this for button: ", JSON.stringify(assetUpdateMessage));
                        cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage));
                        cbClient.publish("_monitor/asset/default/data", JSON.stringify(gatewayUpdateMessage));
                    }, 10000);
                    return;
                } else {
                    assetUpdateMessage.custom_data.button_pushed = false; // continue to post historical data
                }
            } else if (msg.deviceInfo.deviceProfileName.includes("EM300-TH")) {
                assetUpdateMessage.type = "EM300-TH";
                assetUpdateMessage.custom_data.temperature = Math.round((((9 / 5) * (assetUpdateMessage.custom_data.temperature)) + 32) * 10) / 10;
            } else if (msg.deviceInfo.deviceProfileName.includes("AM103L")) {
                assetUpdateMessage.type = "AM103L";
                assetUpdateMessage.custom_data.temperature = Math.round((((9 / 5) * (assetUpdateMessage.custom_data.temperature)) + 32) * 10) / 10;
            } else {
                log("unsupported asset type " + msg.deviceInfo.deviceProfileName);
                return;
            }

            // *********** PUBLISH ***********
            log("Publishing this: ", JSON.stringify(assetUpdateMessage));
            cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage));
            cbClient.publish("_monitor/asset/default/data", JSON.stringify(gatewayUpdateMessage));

        } catch (e) {
            log("failed to parse json: " + e);
        }
    }
}
