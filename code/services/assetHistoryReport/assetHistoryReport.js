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

function assetHistoryReport(req, resp) {
    const db = ClearBlade.Database();
    const params = req.params;

    // The report object to return    
    var reportObj = {
        "columns": [
            { "columnType": "string", "field": "Name", "title": "Name" },
            { "columnType": "string", "field": "Dev EUI", "title": "Dev EUI" },
            { "columnType": "timestamp", "field": "Last Updated", "title": "Last Updated (CST)" },
            { "columnType": "string", "field": "Type", "title": "Type" },
            { "columnType": "string", "field": "Temperature", "title": "Temperature" },
            { "columnType": "string", "field": "Relative Humidity", "title": "Relative Humidity" },
            { "columnType": "string", "field": "Door Status", "title": "Door Status" },
            { "columnType": "string", "field": "Motion Detected", "title": "Motion Detected" },
            { "columnType": "string", "field": "Light Status", "title": "Light Status" },
            { "columnType": "string", "field": "Button Pushed?", "title": "Button Pushed?" },
            { "columnType": "string", "field": "Leak Detected?", "title": "Leak Detected?" },
            { "columnType": "string", "field": "Battery Percent", "title": "Battery Percent" },
            { "columnType": "string", "field": "Reporting?", "title": "Reporting?" }
        ],
        "data": []
    };


    var startDate = parseISOString(params.reportStartDate);
    var endDate = parseISOString(params.reportEndDate);
    console.debug('Given Start: ' + startDate + ' End: ' + endDate);


    startDate = shift(startDate, -1);
    endDate = shift(endDate, -1);
    console.debug('Final Start: ' + startDate + ' End: ' + endDate);

    // Query to retrieve all assets
    var sqlQueryAll = "SELECT * FROM assets";
    db.query(sqlQueryAll, function (err, results) {
        if (err) {
            console.error('Query failed: ', err);
            resp.error(err);
            return;
        }

        console.log("All assets:", results);

        // Create a dictionary of asset IDs to names and types
        var assetDict = {};
        results.forEach(function (asset) {
            assetDict[asset.id] = { name: asset.label, type: asset.type };
        });

        // Adjust the query based on available asset types
        var sqlQuery = "SELECT * FROM assets WHERE type IN ('EM300-TH', 'WS101', 'WS202', 'WS303', 'WS301')";
        db.query(sqlQuery, function (err, results) {
            if (err) {
                console.error('Query failed: ', err);
                resp.error(err);
                return;
            }

            if (results.length === 0) {
                resp.success(reportObj); // No assets found, return empty report
                return;
            }

            var promises = results.map(function (element) {
                return getAndProcessAssetHistory(element, assetDict);
            });

            Promise.all(promises).then(function () {
                reportObj.data.sort(function (b, a) {
                    var dateA = new Date(a["Last Updated"]);
                    var dateB = new Date(b["Last Updated"]);
                    return dateA - dateB;
                });

                resp.success(reportObj);
            }).catch(function (reason) {
                console.log("reason", reason);
                resp.error(reason);
            });
        });
    });

    function getAndProcessAssetHistory(assetDetails, assetDict) {
        var assetId = assetDetails.id.toString();
        var sqlHistoryQuery = "SELECT change_date, changes FROM _asset_history WHERE change_date >= '" + startDate.toISOString() + "' AND change_date <= '" + endDate.toISOString() + "' AND asset_id = '" + assetId + "' ORDER BY change_date;";
        return new Promise(function (resolve, reject) {
            db.query(sqlHistoryQuery, function (err, historyResults) {
                if (err) {
                    console.error("Error fetching history:", err);
                    reject(err);
                    return;
                }

                console.log(assetId + " has " + historyResults.length + " history rows");
                var previousDate = null;
                var gaps = [];

                historyResults.forEach(function (row) {
                    // Log raw data from the database
                    console.log("Raw change_date from DB:", row.change_date);

                    var currentDateUTC = new Date(row.change_date);
                    var currentDateCST = convertUTCtoCST(currentDateUTC);

                    console.log("UTC Date:", currentDateUTC.toISOString());
                    console.log("CST Date:", currentDateCST.toISOString());
                    
                    
                    
                    if (previousDate) {
                        var diff = (currentDateUTC - previousDate) / 1000; // difference in seconds
                        if (diff > 3600) { // if the gap is more than an hour
                            gaps.push({ start: previousDate, end: currentDateUTC, duration: diff });
                        }
                    }
                    

                    previousDate = currentDateUTC;
                    

                    // Parse changes
                    var changesData = row.changes ? row.changes.custom_data || {} : {};

                    var assetInfo = assetDict[assetId] || { name: "", type: "" };

                    var dataRow = {
                        "Name": assetInfo.name,
                        "Dev EUI": assetId,
                        "Last Updated": currentDateCST.toISOString(), // Store the CST time
                        "Type": assetInfo.type,
                        "Temperature": changesData["temperature"] !== undefined ? changesData["temperature"] : "",
                        "Relative Humidity": changesData["humidity"] !== undefined ? changesData["humidity"] : "",
                        "Door Status": changesData["doorOpen"] !== undefined ? (changesData["doorOpen"] ? "Open" : "Closed") : "",
                        "Motion Detected": changesData["motion"] !== undefined ? (changesData["motion"] ? "Yes" : "No") : "",
                        "Light Status": changesData["daylight"] !== undefined ? (changesData["daylight"] ? "On" : "Off") : "",
                        "Button Pushed?": changesData["button_pushed"] !== undefined ? (changesData["button_pushed"] ? "Yes" : "No") : "",
                        "Leak Detected?": changesData["leak_detected"] !== undefined ? (changesData["leak_detected"] ? "Yes" : "No") : "",
                        "Battery Percent": changesData["battery"] !== undefined ? changesData["battery"] : "",
                        "Reporting?": changesData["Reporting"] ? "Yes" : "No"
                    };
                    reportObj.data.push(dataRow);
                });

                if (gaps.length > 0) {
                    console.debug("Gaps found: ", gaps);
                }

                resolve();
            });
        });
    }

    function convertUTCtoCST(date) {
        const offset = 6;
        const cstDate = new Date(date.getTime() + (offset * 60 * 60 * 1000));
        return cstDate;
    }

    // Date utility functions
    function parseISOString(s) {
        var b = s.split(/\D+/);
        return new Date(Date.UTC(b[0], --b[1], b[2], b[3], b[4], b[5], b[6]));
    }

    function getTimezoneInfo() {
        var http = Requests();
        var timezoneInfo;
        http.get({ uri: "https://timeapi.io/api/TimeZone/zone?timeZone=America/Chicago" }, function (err, data) {
            if (err)
                resp.error("Unable to HTTP GET: " + JSON.stringify(err));
            timezoneInfo = JSON.parse(data);
            // just interested in the DST info for now
        });
        return timezoneInfo.dstInterval;
    }

    function getOffset(date) {
        var msDate = date.valueOf();
        var dstInfo = getTimezoneInfo();
        if (msDate < dstInfo.dstStart && msDate > dstInfo.dstEnd)
            return 5;
        else // DST
            return 6;
    }

    function shift(date, direction) {
        var offset = getOffset(date); 
        var shift = offset * direction;
        var shiftedDate = new Date(date.getTime() + (shift * 60 * 60 * 1000));
        return shiftedDate;
    }
}