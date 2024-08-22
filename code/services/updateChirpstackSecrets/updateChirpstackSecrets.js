/**
 * Type: Micro Service
 * Description: Receives secrets for Chirpstack integration and updates them in the system.
 * @param {CbServer.BasicReq} req
 * @param {string} req.systemKey
 * @param {string} req.systemSecret
 * @param {string} req.userToken
 * @param {Object} req.params
 * @param {CbServer.Resp} resp
 */

function updateChirpstackSecrets(req, resp) {
    // Extract the secrets from the request parameters
    var secretsPayload = req.params;

    // Initialize the Secret object
    const Secret = ClearBladeAsync.Secret();

    // Function to update each secret in the system
    function updateSecret(name, data) {
        return Secret.update(name, data)
            .then(function () {
                log(`Secret ${name} updated successfully.`);
            })
            .catch(function (error) {
                log(`Error updating secret ${name}: ${JSON.stringify(error)}`);
                throw new Error(`Unable to update secret ${name}: ${error.message}`);
            });
    }

    // Update all secrets received in the payload
    Promise.all([
        updateSecret("Chirpstack_CA_Cert", secretsPayload.Chirpstack_CA_Cert),
        updateSecret("Chirpstack_Client_Cert", secretsPayload.Chirpstack_Client_Cert),
        updateSecret("Chirpstack_Client_Key", secretsPayload.Chirpstack_Client_Key)
    ])
    .then(function () {
        resp.success("All Chirpstack secrets updated successfully.");
    })
    .catch(function (error) {
        log("Error in updateChirpstackSecrets: " + JSON.stringify(error));
        resp.error("Error updating Chirpstack secrets: " + error.message);
    });
}
