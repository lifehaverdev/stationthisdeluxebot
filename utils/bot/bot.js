const TelegramBot = require("node-telegram-bot-api");
const botToken = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(botToken,
    {
        polling: true
    });
const startup = Date.now();
const lobby = {};
const stateHandlers = {};//from imessage
const actionMap = {}; const prefixHandlers = {};
const workspace = {};
const studio = {};
let taskQueue = []
let waiting = []
let successors = []
let failures = []
let loraTriggers = [];
let burns = [];
let rooms = [];
let flows = [];
let processes = [];
const STATES = {
    IDLE: 'IDLE',
    SIGN_IN: 'SIGN_IN',

    MAKE: 'MAKE',
    MAKE3: 'MAKE3',
    MOG: 'MOG',
    MILADY: 'MILADY',
    CHUDJAK: 'CHUDJAK',
    RADBRO: 'RADBRO',
    LOSER: 'LOSER',
    FLUX: 'FLUX',
    IMG2IMG: 'IMG2IMG',
    FLUX2IMG: 'FLUX2IMG',
    FLUXPROMPT: 'FLUXPROMPT',
    MS3: 'MS3',
    MS3V2: 'MS3V2',
    MS2PROMPT: 'MS2PROMPT',
    INPAINT: 'INPAINT',
    INPAINTPROMPT: 'INPAINTPROMPT',
    INPAINTTARGET: 'INPAINTTARGET',
    PFP: 'PFP',
    ASSIST: 'ASSIST',
    FLASSIST: 'FLASSIST',
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

    LORANAME: 'LORANAME',
    ADDLORAIMAGE: 'ADDLORAIMAGE',

    SETGROUPNFTCA: 'SETGROUPNFTCA',
    SETGROUPTOKENCA: 'SETGROUPTOKENCA',
    SETGROUPTICKER: 'SETGROUPTICKER',
    SETGROUPGATE: 'SETGROUPGATE',
    SETGROUPGATEMSG: 'SETGROUPGATEMSG',
    SETGROUPCUSTCOM: 'SETGROUPCUSTCOM',

    COLLECTIONNAME: 'COLLECTIONNAME',

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
    'SETBATCH': "input_batch",
    'SETSTEPS': "input_steps",
    'SETCFG': "input_cfg",
    'SETSTRENGTH': "input_strength",
    'SETPROMPT': "prompt",
    'SETUSERPROMPT': "userPrompt",
    'SETNEGATIVEPROMPT': "input_negative",
    'SETSEED': 'input_seed',
    'SETPHOTO': 'input_image',
    'SETSIZE': 'photoStats',
    'SETSTYLE': 'input_style_image',
    'SETCONTROL': 'input_control_image',
    'SETPOSE': 'input_pose_image'
    //'SETGROUPAPPLY': 'group'
}


function makeSeed(userId) {
    //console.log(lobby[userId])
    if(lobby[userId] && (userId == -1 || (lobby[userId].input_seed && lobby[userId].input_seed == -1) || lobby[userId].seed == -1)){
        return Math.floor(Math.random() * 1000000);
    } else if(lobby[userId]){
        return lobby[userId].input_seed;
    } else {
        return Math.floor(Math.random() * 1000000);
    }
};



async function getPhotoUrl(input) {
    let fileId;

    if (input.photo) {
        // Case when the entire message object is passed
        fileId = input.photo[input.photo.length - 1].file_id;
    } else if (input.document) {
        // Case when the message contains a document
        fileId = input.document.file_id;
    } else if (input.file_id) {
        // Case when a single photo or document is passed directly
        fileId = input.file_id;
    } else {
        return;
    }

    try {
        const photoInfo = await bot.getFile(fileId);
        const photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${photoInfo.file_path}`;
        return photoUrl;
    } catch (error) {
        console.error("Error fetching photo URL:", error);
        return null;
    }
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
        //console.log('burn record',burnRecord.burned)
        burned += parseInt(burnRecord.burned) * 2 / 1000000;
    }
    return burned;
}

function getGroup(message) {
    const group = rooms.find(group => group.chat.id == message.chat.id)
    return group;
}

function getGroupById(groupChatId) {
    const group = rooms.find(group => group.chat.id == groupChatId)
    return group;
}


module.exports = {
    getBotInstance: function () {
        return bot;
    },
    makeSeed,
    getPhotoUrl,
    getNextPeriodTime,
    getBurned,
    getGroup, getGroupById,
    lobby, 
    workspace, studio,
    stateHandlers,
    actionMap, prefixHandlers,
    rooms, flows, burns, loraTriggers,
    taskQueue, waiting, processes, successors, failures,
    startup,
    SET_COMMANDS,
    STATE_TO_LOBBYPARAM,
    SETTER_TO_STATE,
    STATES
};