const lobby = {};
const stateHandlers = {};//from imessage
const actionMap = {}; const prefixHandlers = {};
const workspace = {};
const abacus = {};
const commandRegistry = {};
const studio = {};
// Add the new globalStatus object
const globalStatus = {
    training: [],    // Array to track LoRA training status
    cooking: [],     // Array to track collection cooking status
    chargePurchases: [] // Array to track recent charge purchases
};

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
    QUICKMAKE: 'QUICKMAKE',

    EFFECTHANG: 'EFFECTHANG',
    PFP: 'PFP',
    QUICKIMG2IMG: 'QUICKIMG2IMG',
    IMG2IMG: 'IMG2IMG',
    SD32IMG: 'SD32IMG',
    SD32IMGPROMPT: 'SD32IMGPROMPT',
    QUICKPROMPT: 'QUICKPROMPT',
    MS2PROMPT: 'MS2PROMPT',

    MS3: 'MS3',
    MS3V2: 'MS3V2',
    
    //inpaint
    INPAINT: 'INPAINT',
    INPAINTPROMPT: 'INPAINTPROMPT',
    INPAINTTARGET: 'INPAINTTARGET',

    //utils
    ASSIST: 'ASSIST',
    FLASSIST: 'FLASSIST',
    QUICKINTERROGATION: 'QUICKINTERROGATION',
    DISC: 'DISC',
    WATERMARK: 'WATERMARK',
    RMBG: 'RMBG',
    UPSCALE: 'UPSCALE',

    SPEAK: 'SPEAK',

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
    SETLORACAPTION: 'SETLORACAPTION',

    SETGROUPNFTCA: 'SETGROUPNFTCA',
    SETGROUPTOKENCA: 'SETGROUPTOKENCA',
    SETGROUPTICKER: 'SETGROUPTICKER',
    SETGROUPGATE: 'SETGROUPGATE',
    SETGROUPGATEMSG: 'SETGROUPGATEMSG',
    SETGROUPCUSTCOM: 'SETGROUPCUSTCOM',

    COLLECTIONNAME: 'COLLECTIONNAME',

    SETCOLLECTION: 'SETCOLLECTION',
    
    CUSTOMFILENAME: 'CUSTOMFILENAME',

    TRIPO: 'TRIPO',

    SETEXPORT: 'SETEXPORT',

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
    lobby, 
    workspace, studio, abacus,
    globalStatus,
    stateHandlers,
    actionMap, prefixHandlers, commandRegistry,
    rooms, flows, burns, loraTriggers,
    taskQueue, waiting, processes, successors, failures,
    startup,
    SET_COMMANDS,
    STATE_TO_LOBBYPARAM,
    SETTER_TO_STATE,
    STATES,
    makeSeed,
    getBurned,
    getGroup, getGroupById,
}