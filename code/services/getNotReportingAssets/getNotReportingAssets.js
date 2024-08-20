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

function getNotReportingAssets(req, resp) {
    // These are parameters passed into the code service
    ClearBlade.init({ request: req });
    var cbdb = ClearBlade.Database();

    //1. Get all assets not reporting
    //2. Set custom data Reporting flag to false
    //3. Update the custom data contents in the db
    //      - We cannot publish to _dbupdate/_monitor/_asset/{asset id}/status because that service
    //          updates the last_updated column, which will break all of this.
    //4. Publish to:
    //      - _dbupdate/_monitor/_asset/{asset id}/status
    //      - _rules/_monitor/_asset/{asset id}
    //
    // {
    //   "custom_data": {
    //     "Reporting": false
    //   },
    //   "id": "at-atp35690c70b24",
    //   "type": "Jack",
    // }

    const NOT_REPORTING_CUTOFF_IN_MINUTES = 31;
    var cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - NOT_REPORTING_CUTOFF_IN_MINUTES);

    log("Retrieving all assets that have not reported since " + cutoffTime.toISOString());

    var cbdb = ClearBlade.Database();
    cbdb.query("select id, type, group_id, last_updated, custom_data from assets where last_updated <= '" + cutoffTime + "'", function (err, data) {
        if (err) {
            resp.error("Error executing query: " + JSON.stringify(data));
        } else {
            //At this point, our assets array contains all devices that are currently not reporting
            var messaging = ClearBlade.Messaging();
            var promises = [];
            for (var i = 0; i < data.length; i++) {
                var assetCustomData = {};
                if (!!data[i].custom_data) {
                    assetCustomData = JSON.parse(data[i].custom_data);
                }

                log("asset id: " + data[i].id)
                log("asset custom_data")
                log(assetCustomData)

                if (data[i].type !== "gateway" || (new Date(data[i].last_updated) < cutoffTime)) { //offset for gateways to report after
                    //See if the Reporting flag exists and has changed, ignore it if it hasn't changed
                    if (!assetCustomData.hasOwnProperty("Reporting") || assetCustomData.Reporting == true) {
                        log("Updating asset custom data")

                        var payload = JSON.stringify(
                            {
                                "id": data[i].id,
                                "type": data[i].type,
                                "last_updated": new Date().toISOString(),
                                "custom_data": {
                                    "Reporting": false
                                }
                            }
                        );

                        assetCustomData.Reporting = false;

                        //Update the Reporting flag for the device if it is not already false
                        promises.push(updateReportingFlag(data[i].id, assetCustomData));

                        //_dbupdate/_monitor/_asset/data[i].id/status - We don't want to invoke the asset status
                        //update because the last_updated date would then be populated, thereby screwing up this
                        //process
                        messaging.publish("_history/_monitor/_asset/" + data[i].id, payload);
                        messaging.publish("_rules/_monitor/_asset/" + data[i].id, payload);
                    } else {
                        log("Custom data not modified")
                    }


                }
            }

            Promise.all(promises)
                .then(function (data) {
                    resp.success(data);
                })
                .catch(function (error) {
                    resp.error(error);
                });
        }
    });

    function updateReportingFlag(assetId, customData) {
        return new Promise(function (resolve) {
            var query = ClearBlade.Query({ collectionName: "assets" });
            query.equalTo("id", assetId);
            updateAsset(query, { "custom_data": JSON.stringify(customData) }, function (err, data) {
                if (err) {
                    resolve("Error saving custom data for asset " + assetId + ": " + JSON.stringify(data));
                } else {
                    resolve("Asset " + assetId + " updated");
                }
            });
        });
    }

    function updateAsset(query, updates, callback) {
        query.update(updates, callback);
    }
}
