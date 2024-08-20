/**
 * Type: Stream Service
 * Description: A service that does not have an execution timeout which allows for infinite execution of logic.
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

    ClearBlade.init({ request: req });

    var count = 0;

    log("service starting")

    var radLoRaOptions = {
        address: "52.91.153.120",
        port: 1883
    };

    //the client that connects to chirpstack
    var loraClient;
    try {
        loraClient = new MQTT.Client(radLoRaOptions);
        log("connected to lora client")
    } catch (e) {
        resp.error("failed to init lora client: " + e);
    }

    //log("creating cb client");
    var cbClient;
    try {
        cbClient = new MQTT.Client();
    } catch (e) {
        resp.error("failed to init cb client: " + e);
    }

    // This is the topic needed for the sensor uplink
    const LORA_UPLINK_TOPIC = "application/+/device/+/event/up"

    loraClient.subscribe(LORA_UPLINK_TOPIC, function (topic, msg) {
        log("topic: " + topic);
        log("raw message: " + JSON.stringify(msg));
        processMessage(msg, topic);
    });


    function processMessage(msg) {
        try {

            //UPDATE REGULAR ASSET
            var payload = new TextDecoder("utf-8").decode(msg.payload_bytes);
            log("message")
            log(JSON.stringify(payload))
            msg = JSON.parse(payload);
            log("keys are " + Object.keys(msg))
            var device = msg.deviceInfo.devEui
            // log("device data is: ", msg.data)
            log("DEVICE is: ", device)
            var keys = Object.keys(msg)


            var assetUpdateMessage = {
                id: msg.deviceInfo.devEui, //ID Of the unique asset
                type: msg.deviceInfo.deviceProfileName,  //Type of Asset to update, ex: "EM-300-TH"
                custom_data: {
                    Reporting: true
                },
                group_ids: ["000001"]
            }
            if(msg.deviceInfo.deviceProfileName.includes("WS301")){
                assetUpdateMessage.type = "WS301"
            }else if (msg.deviceInfo.deviceProfileName.includes("WS202")){
                assetUpdateMessage.type = "WS202"
            }

            var attributes = Object.keys(msg.object) //this field contains sensor data
            for (x = 0; x < attributes.length; x++) {
                assetUpdateMessage.custom_data[attributes[x]] = msg.object[attributes[x]]
            }

            // *********** PUBLISH ***********
            log("Publishing this: ", JSON.stringify(assetUpdateMessage));
            cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage))


            //UPDATE CES DASHBOARD:
            if (device === "24e124725d243358") { //Indoor airquality
                ID_1 = "air_quality_sensor_1";
                ID_2 = "31913feb-50ba-46bb-90cc-f17d94bcffe4" //the store ID
                //publish for sensor
                assetUpdateMessage.id = ID_1
                assetUpdateMessage.type = "AM103L"
                assetUpdateMessage.group_ids = ["000001"]
                assetUpdateMessage.custom_data.temperature = Math.round((((9/5)*(assetUpdateMessage.custom_data.temperature)) + 32)*10)/10
                log("Publishing this for air_quality_sensor_1: ", JSON.stringify(assetUpdateMessage));
                cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage))

                //publish for store
                assetUpdateMessage.id = ID_2
                assetUpdateMessage.type = "store"
                assetUpdateMessage.group_ids = ["CES"]
                log("Publishing this for store: ", JSON.stringify(assetUpdateMessage));
                cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage))
            } else if (device === "24e124136d376160") { //fridge temp
                ID_1 = "temp_humidity_sensor_1"; //fridge temp
                ID_2 = "3d0b744b-8b83-4767-9cb3-9f394caf70b6" //refrigerator
                //publish for sensor
                assetUpdateMessage.id = ID_1
                assetUpdateMessage.type = "EM300-TH"
                assetUpdateMessage.group_ids = ["000001"]
                assetUpdateMessage.custom_data.temperature = Math.round((((9/5)*(assetUpdateMessage.custom_data.temperature)) + 32)*10)/10
                log("Publishing this for temp_humidity_sensor_1: ", JSON.stringify(assetUpdateMessage));
                cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage))

                //publish for refrigerator
                assetUpdateMessage.id = ID_2
                assetUpdateMessage.type = "refrigerator"
                assetUpdateMessage.group_ids = ["CES"]
                assetUpdateMessage.custom_data.isRunning = true //if we have temp, fridge is running
                log("Publishing this for refrigerator: ", JSON.stringify(assetUpdateMessage));
                cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage))
            } else if (device === "24e124538d221950") {
                ID_1 = "motion_detection_sensor_1"; //PIR Sensor
                ID_2 = "3d0b744b-8b83-4767-9cb3-9f394caf70b6" //refrigerator
                assetUpdateMessage.custom_data.motion = assetUpdateMessage.custom_data.pir === "normal" ? false : true
                if (assetUpdateMessage.custom_data.pir !== "normal") {
                    count++
                }
                assetUpdateMessage.custom_data.motionCount = count

                //publish for sensor
                assetUpdateMessage.id = ID_1
                assetUpdateMessage.type = "EM300-TH"
                assetUpdateMessage.group_ids = ["000001"]
                log("Publishing this for motion_detection_sensor_1: ", JSON.stringify(assetUpdateMessage));
                cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage))

                //publish for refrigerator
                assetUpdateMessage.id = ID_2
                assetUpdateMessage.type = "refrigerator"
                assetUpdateMessage.group_ids = ["CES"]
                log("Publishing this for refrigerator: ", JSON.stringify(assetUpdateMessage));
                cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage))
            } else if (device === "24e124141d314571") {
                log("door status " + assetUpdateMessage.custom_data.magnet_status)
                ID_1 = "door_open_closed_sensor"; //door Sensor
                ID_2 = "3d0b744b-8b83-4767-9cb3-9f394caf70b6" //refrigerator

                if(assetUpdateMessage.custom_data.magnet_status === "close"){
                    assetUpdateMessage.custom_data.doorOpen = false
                }else{
                    assetUpdateMessage.custom_data.doorOpen = true
                }


                //publish for sensor
                assetUpdateMessage.id = ID_1
                assetUpdateMessage.type = "WS301"
                assetUpdateMessage.group_ids = ["000001"]
                log("Publishing this for door_open_closed_sensor: ", JSON.stringify(assetUpdateMessage));
                cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage))

                assetUpdateMessage.id = ID_2
                assetUpdateMessage.type = "refrigerator"
                assetUpdateMessage.group_ids = ["CES"]
                log("Publishing this for refrigerator: ", JSON.stringify(assetUpdateMessage));
                cbClient.publish("_monitor/asset/default/data", JSON.stringify(assetUpdateMessage))
            }

        }
        catch (e) {
            log("failed to parse json: " + e);
        }
    }

}