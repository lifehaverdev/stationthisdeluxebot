// vidu.js
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

function imageToBase64(filePath) {
  const ext = filePath.split('.').pop();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  const data = fs.readFileSync(filePath);
  return `data:image/${mime};base64,${data.toString('base64')}`;
}

const VIDU_API_KEY = process.env.VIDU_API_KEY;
const VIDU_API_URL = 'https://api.vidu.com/ent/v2/img2video';
const VIDU_STATUS_URL = 'https://api.vidu.com/ent/v2/tasks';

async function generateViduVideo(promptObj, processWaitlist) {
    const { imageFile, username } = promptObj;

    const imageBuffer = await fs.promises.readFile(imageFile);
    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    const postRes = await axios.post(
        VIDU_API_URL,
        {
            model: 'vidu2.0',
            images: [base64Image],
            prompt: `${username}'s animation`,
            duration: 4,
            resolution: '720p',
            movement_amplitude: 'medium',
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${VIDU_API_KEY}`
            }
        }
    );

    const taskId = postRes.data.task_id;

    for (let i = 0; i < 20; i++) {
        const res = await axios.get(`${VIDU_STATUS_URL}/${taskId}/creations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${VIDU_API_KEY}`
            }
        });

        const { state, creations } = res.data;

        console.log(`[VIDU] Polling attempt ${i + 1} — Status: ${state}`);

        if (state === 'success' && creations?.length) {
            const outputs = [{
                type: 'video',
                url: creations[0].url
            }];

            if (typeof processWaitlist === 'function') {
                processWaitlist('success', taskId, outputs);
            }

            return taskId;
        }

        if (state === 'failed') {
            if (typeof processWaitlist === 'function') {
                processWaitlist('failed', taskId, []);
            }
            return -1;
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.error('[VIDU] Polling timed out');
    if (typeof processWaitlist === 'function') {
        processWaitlist('timeout', taskId, []);
    }
    return -1;
}


async function pollStatus(taskId, interval = 5000, maxAttempts = 20) {
for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = `${VIDU_STATUS_URL}/${taskId}/creations`;

    const res = await axios.get(url, {
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${VIDU_API_KEY}`
    }
    });

    const { state, creations } = res.data;

    console.log(`🔄 [${attempt + 1}] Task ${taskId} is in state: ${state}`);

    if (state === 'success' && creations?.length > 0) {
    console.log(`✅ Video Ready!\n🎥 Video URL: ${creations[0].url}\n🖼️ Cover: ${creations[0].cover_url}`);
    return creations[0];
    } else if (state === 'failed') {
    console.error(`❌ Generation failed for task ${taskId}`);
    return null;
    }

    await new Promise(resolve => setTimeout(resolve, interval));
}

console.error('❌ Timed out waiting for generation to complete');
return null;
}


// async function generateViduVideo(promptObj, callback) {
//     const { imageFile, username } = promptObj;

//     // Convert image to base64
//     const imageBuffer = await fs.promises.readFile(imageFile);
//     const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

//     const postRes = await axios.post(
//         VIDU_API_URL,
//         {
//             model: 'vidu2.0',
//             images: [base64Image],
//             prompt: promptObj.prompt, // you can customize
//             duration: 4,
//             resolution: '720p',
//             movement_amplitude: 'medium',
//         },
//         {
//             headers: {
//                 'Content-Type': 'application/json',
//                 'Authorization': `Token ${VIDU_API_KEY}`
//             }
//         }
//     );

//     const taskId = postRes.data.task_id;

//     // Poll until success
//     for (let i = 0; i < 20; i++) {
//         const res = await axios.get(`${VIDU_STATUS_URL}/${taskId}/creations`, {
//             headers: {
//                 'Content-Type': 'application/json',
//                 'Authorization': `Token ${VIDU_API_KEY}`
//             }
//         });

//         const { state, creations } = res.data;

//         if (state === 'success' && creations?.length) {
//             return {
//                 type: 'video',
//                 url: creations[0].url,
//                 cover: creations[0].cover_url
//             };
//         } else if (state === 'failed') {
//             throw new Error('Vidu task failed');
//         }

//         await new Promise(resolve => setTimeout(resolve, 5000));
//     }

//     throw new Error('Vidu polling timed out');
// }

async function startViduGeneration(promptObj) {
    const { imageFile, username, prompt } = promptObj;

    const imageBuffer = await fs.promises.readFile(imageFile);
    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    const res = await axios.post(
        VIDU_API_URL,
        {
            model: 'vidu2.0',
            images: [base64Image],
            prompt: prompt || `${username}'s animation`,
            duration: 4,
            resolution: '720p',
            movement_amplitude: 'medium',
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${VIDU_API_KEY}`
            }
        }
    );

    return res.data.task_id;
}

async function startViduUpscale(promptObj) {
    const res = await axios.post(
        'https://api.vidu.com/ent/v2/upscale',
        {
            model: 'vidu1.0',
            creation_id: promptObj.creationId
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${VIDU_API_KEY}`
            }
        }
    );

    return res.data.task_id;
}


async function pollViduUntilSuccess(taskId, processWaitlist) {
    for (let i = 0; i < 20; i++) {
        const res = await axios.get(`${VIDU_STATUS_URL}/${taskId}/creations`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${VIDU_API_KEY}`
            }
        });

        const { state, creations } = res.data;

        console.log(`[VIDU] Poll #${i + 1} → ${state}`);

        if (state === 'success' && creations?.length) {
            processWaitlist('success', taskId, [
                { type: 'video', url: creations[0].url }
            ]);
            return;
        }

        if (state === 'failed') {
            processWaitlist('failed', taskId, []);
            return;
        }

        await new Promise(res => setTimeout(res, 5000));
    }

    processWaitlist('timeout', taskId, []);
}


async function main() {
const taskId = await generateVideo({
    model: 'vidu2.0',
    imageUrl: imageToBase64('/Users/lifehaver/make/stationthisdeluxebot/loraExamples/petravoiceflux2.jpg'),
    prompt: 'A majestic castle floating in the sky, dramatic lighting',
    duration: 4,
    resolution: '720p',
    movement: 'medium'
});

await pollStatus(taskId);
}


if (require.main === module) {
  main();
}



////imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/800px-Fronalpstock_big.jpg',
//imageUrl: imageToBase64('/Users/lifehaver/make/stationthisdeluxebot/loraExamples/petravoiceflux2.jpg'),

module.exports = {
    generateViduVideo,
    startViduGeneration,
    startViduUpscale,
    pollViduUntilSuccess
}