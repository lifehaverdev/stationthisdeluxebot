const TelegramBot = require("node-telegram-bot-api");
const botToken = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(botToken,
    {
        //webHook: true,
        //webHookPort: 443,
        polling: true
    });
const startup = Date.now();
const lobby = {};
const rooms = [{
    owner: 5472638766,
    admins: [],
    chat: {
        id: -1002225298833 //stationthisofficial
    },
    settings: {
        basePrompt: "petravoice",
        checkpoint: "zavychromaxl_v70.safetensors",
        voiceModel: "165UvtZp7kKnmrVrVQwx",
        batchMax: 1,
        points: 0,
        steps: 30,
        cfg: 7,
        strength: .6,
        prompt: '',
        userBasePrompt: '',
        negativePrompt: '',
        seed: -1,
        lastSeed: -1,
        fileUrl: '',
        photoStats: {
            height: 1024,
            width: 1024,
        },
        tempSize: {
            height: 500,
            width: 500
        },
        state: {
            state: 'IDLE',
            chatId: null,
            messageThreadId: null
        },
        type: '',
    }
}];
const STATES = {
    IDLE: 'IDLE',
    SIGN_IN: 'SIGN_IN',

    MAKE: 'MAKE',
    IMG2IMG: 'IMG2IMG',
    MS3: 'MS3',
    MS2PROMPT: 'MS2PROMPT',
    INPAINT: 'INPAINT',
    MASK: 'MASK',
    MASKPROMPT: 'MASKPROMPT',
    PFP: 'PFP',
    ASSIST: 'ASSIST',
    SPEAK: 'SPEAK',
    INTERROGATION: 'INTERROGATION',
    DISC: 'DISC',
    WATERMARK: 'WATERMARK',


    SETBATCH: 'SETBATCH',
    SETSTEPS: 'SETSTEPS',
    SETCFG: 'SETCFG',
    SETSTRENGTH: 'SETSTRENGTH',
    SETPROMPT: 'SETPROMPT',
    SETUSERPROMPT: 'SETUSERPROMPT',
    SETNEGATIVEPROMPT: 'SETNEGATIVEPROMPT',
    SETSEED: 'SETSEED',
    SETPHOTO: 'SETPHOTO',
    SETSIZE: 'SETSIZE',
    SETSTYLE: 'SETSTYLE',
    SETCONTROL: 'SETCONTROL',

    VERIFY: 'VERIFY',

    REQUEST: 'REQUEST',

    COLLECTIONURI: 'URI',
    COLLECTIONBASEPROMPT: 'COLBASE'
    // Add more states as needed
};
//for setters
const SET_COMMANDS = [
    'prompt', 'userprompt', 'negprompt', 'photo', 'type',
    'steps', 'batch', 'seed', 'size', 'strength', 'cfg', 'style',
    'control',
];
const SETTER_TO_STATE = {
    setbatch: STATES.SETBATCH,
    setsteps: STATES.SETSTEPS,
    setcfg: STATES.SETCFG,
    setstrength: STATES.SETSTRENGTH,
    setprompt: STATES.SETPROMPT,
    setuserprompt: STATES.SETUSERPROMPT,
    setnegprompt: STATES.SETNEGATIVEPROMPT,
    setseed: STATES.SETSEED,
    setphoto: STATES.SETPHOTO,
    setsize: STATES.SETSIZE,
    setstyle: STATES.SETSTYLE,
    setcontrol: STATES.SETCONTROL,
    // Add more mappings as needed
};
const STATE_TO_LOBBYPARAM = {
    'SETBATCH': "batchMax",
    'SETSTEPS': "steps",
    'SETCFG': "cfg",
    'SETSTRENGTH': "strength",
    'SETPROMPT': "prompt",
    'SETUSERPROMPT': "userBasePrompt",
    'SETNEGATIVEPROMPT': "negativePrompt",
    'SETSEED': 'seed',
    'SETPHOTO': 'fileUrl',
    'SETSIZE': 'photoStats',
    'SETSTYLE': 'stylefileUrl',
    'SETCONTROL': 'controlfileUrl'
}

const commandStateMessages = {
    '/disc': {
        state: STATES.DISC,
        message: 'What photo or file will you write to a disc?'
    },
    '/watermark': {
        state: STATES.WATERMARK,
        message: 'What photo or file will you brand?'
    },
    '/interrogate': {
        state: STATES.INTERROGATION,
        message: "Send in the photo you want to reverse engineer a prompt from."
    },
    '/quit': {
        state: STATES.IDLE,
        message: 'okay i reset your station'
    },
    '/request': {
        state: STATES.REQUEST,
        message: `Give us the link to the model you want`
    },
    '/inpaint': {
        state: STATES.INPAINT,
        message: 'What image are you inpainting?'
    },
    '/ms2': {
        state: STATES.IMG2IMG,
        message: "Send in the photo you want to img to img."
    },
    '/ms3': {
        state: STATES.MS3,
        message: "Send in a photo you want to img2vid, better be a square"
    },
    '/pfp': {
        state: STATES.PFP,
        message: "Send in a photo and I will automatically img2img it with my own prompt"
    },
    '/assist': {
        state: STATES.ASSIST,
        message: "Tell me the idea or key words you want a prompt for"
    },
    '/speak': {
        state: STATES.SPEAK,
        message: "What should I say"
    }
    // Add other commands as needed
};

function makeSeed(userId) {
    if(userId == -1 || lobby[userId].seed == -1){
        return Math.floor(Math.random() * 1000000);
    } else if(lobby[userId]){
        return lobby[userId].seed;
    } else {
        return Math.floor(Math.random() * 1000000);
    }
};

async function getPhotoUrl(message) {
    let fileId;
    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document) {
        fileId = message.document.file_id;
    }
    const photoInfo = await bot.getFile(fileId);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${photoInfo.file_path}`;
    console.log(photoUrl);
    return photoUrl
}


module.exports = {
    getBotInstance: function () {
        return bot;
    },
    makeSeed,
    getPhotoUrl,
    lobby,
    rooms,
    startup,
    commandStateMessages,
    SET_COMMANDS,
    STATE_TO_LOBBYPARAM,
    SETTER_TO_STATE,
    STATES
};