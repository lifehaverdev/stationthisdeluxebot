
const http = require("http");

// Function to make the API request and handle the response
async function interrogateImage(message, photoUrl) {
    const start = process.hrtime();
    const chatId = message.chat.id
    console.log(photoUrl);
    try {

        const promptRequest = JSON.stringify({
            image: photoUrl,
            model: "clip" 
        });

        console.log("Prompt request:", promptRequest); // Log the prompt request

            //to save time
        const options = {
            host: process.env.SD_API_HOST,
            port: process.env.SD_API_PORT,
            path: "/sdapi/v1/interrogate",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(promptRequest)
            }
        };

        const response = await new Promise((resolve, reject) => {
            const req = http.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
            });

            req.on("error", reject);
            req.write(promptRequest);
            req.end();
        });

        console.log("Response status code:", response.statusCode);
        // console.log("Response body:", response.body);

        const result = JSON.parse(response.body);
        if (result) {
            //console.log(result);
            const end = process.hrtime();
            const time = end[0] - start[0];
            //console.log(time);
            const receipt = {
                time: time,
                result: result.caption
            }
            return receipt;

        } else {
            console.error("No images found in the response.");
        }
    } catch (error) {
        console.error("Error generating image:", error);
    }

}


module.exports = {
    interrogateImage
}