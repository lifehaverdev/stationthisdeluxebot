const TelegramBot = require("node-telegram-bot-api");
const botToken = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(botToken,
    {
        polling: true
    });
const startup = Date.now();
const lobby = {};
let taskQueue = []
let waiting = []
let loraTriggers = [];
let burns = [];
let rooms = [];
let flows = [];
const STATES = {
    IDLE: 'IDLE',
    SIGN_IN: 'SIGN_IN',

    MAKE: 'MAKE',
    MAKE3: 'MAKE3',
    MOG: 'MOG',
    IMG2IMG: 'IMG2IMG',
    MS3: 'MS3',
    MS2PROMPT: 'MS2PROMPT',
    INPAINT: 'INPAINT',
    INPAINTPROMPT: 'INPAINTPROMPT',
    INPAINTTARGET: 'INPAINTTARGET',
    PFP: 'PFP',
    ASSIST: 'ASSIST',
    SPEAK: 'SPEAK',
    INTERROGATION: 'INTERROGATION',
    DISC: 'DISC',
    WATERMARK: 'WATERMARK',
    RMBG: 'RMBG',
    UPSCALE: 'UPSCALE',


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
    SETPOSE: 'SETPOSE',

    VERIFY: 'VERIFY',

    REQUEST: 'REQUEST',

    GROUPAPPLY: 'GROUPAPPLY',
    GROUPNAME: 'GROUPNAME',
    WL: 'WL',

    // Add more states as needed
};
//for setters
const SET_COMMANDS = [
    'prompt', 'userprompt', 'negprompt', 'photo', 'type',
    'steps', 'batch', 'seed', 'size', 'strength', 'cfg', 'style',
    'control', 'pose'
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
    setpose: STATES.SETPOSE,
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
    'SETSTYLE': 'styleFileUrl',
    'SETCONTROL': 'controlFileUrl',
    'SETPOSE': 'poseFileUrl'
    //'SETGROUPAPPLY': 'group'
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
    // '/speak': {
    //     state: STATES.SPEAK,
    //     message: "What should I say"
    // }
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
    } else {
        return
    }
    const photoInfo = await bot.getFile(fileId);
    const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${photoInfo.file_path}`;
    //console.log(photoUrl);
    return photoUrl
}

function getNextPeriodTime(startup) {
    const currentTime = Date.now();
    const elapsedMilliseconds = currentTime - startup;
    const eightHoursInMilliseconds = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

    // Calculate remaining milliseconds until the next 8-hour period
    const remainingMilliseconds = eightHoursInMilliseconds - (elapsedMilliseconds % eightHoursInMilliseconds);

    // Convert remaining time to minutes
    const remainingMinutes = Math.floor(remainingMilliseconds / 1000 / 60);

    return remainingMinutes;
}

function getBurned(userId) {

    const burnRecord = burns.find(burn => burn.wallet === lobby[userId].wallet);
    let burned = 0;
    if (burnRecord) {
        console.log('burn record',burnRecord.burned)
        burned += parseInt(burnRecord.burned) * 2 / 1000000;
    }
    return burned;
}


module.exports = {
    getBotInstance: function () {
        return bot;
    },
    makeSeed,
    getPhotoUrl,
    getNextPeriodTime,
    getBurned,
    lobby,
    rooms, flows, burns, loraTriggers,
    taskQueue, waiting,
    startup,
    commandStateMessages,
    SET_COMMANDS,
    STATE_TO_LOBBYPARAM,
    SETTER_TO_STATE,
    STATES
};