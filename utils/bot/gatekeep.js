const { lobby, STATES } = require('./bot'); 
const { getUserDataByUserId, addPointsToAllUsers, writeUserData, createDefaultUserData } = require('../../db/mongodb')
const { getBalance, checkBlacklist } = require('../users/checkBalance')
const { setUserState, sendMessage, react } = require('../utils');
const { initialize } =  require('./intitialize')
//const { home } = require('../models/userKeyboards');
let lastCleanTime = Date.now();
const logLobby = true;
const POINTMULTI = 540;
const NOCOINERSTARTER = 199800;
const LOBBY_CLEAN_MINUTE = 15 ///minutes new rules //60 * 8;//8 hours
const LOBBY_CLEAN_INTERVAL = LOBBY_CLEAN_MINUTE * 60 * 1000; 
const DB_REFRESH = 1000*60*15

//User class standalone methods that are now functions becasue user class was useless
function regenerateDoints(userId) {
    //console.log("========== Starting regenerateDoints ==========");
    const userData = lobby[userId];
    //console.log(userData.userId, 'p',userData.points,'d', userData.doints, userData.balance);
    
    if (!userData.kickedAt) {
        console.log("No kickedAt set. Exiting regenerateDoints early.");
        return;
    }

    //console.log(`Last lobbied time: ${new Date(userData.kickedAt).toISOString()}`);
    const timeSinceLastRun = Date.now() - userData.kickedAt;
    
    console.log(`Time since kicked: ${Math.floor(timeSinceLastRun / 1000)} seconds`);
    //console.log('user balance', userData.balance);

    const maxPoints = Math.floor((userData.balance + NOCOINERSTARTER) / POINTMULTI);
    //console.log(`Max points based on balance: ${maxPoints}`);

    const regenerationCycles = Math.floor(timeSinceLastRun / (LOBBY_CLEAN_INTERVAL)); // 15-minute cycles
    console.log(`Regeneration cycles since last run: ${regenerationCycles}`);

    const regeneratedPoints = (maxPoints / 36) * regenerationCycles;
    //console.log(`Regenerated points: ${regeneratedPoints}`);

    // Subtract the regenerated points from the doints and ensure it doesn't drop below 0
    const oldDoints = userData.doints;
    userData.doints = Math.max(oldDoints - regeneratedPoints, 0);
    console.log(`Old doints: ${oldDoints}, New doints after regeneration: ${userData.doints}`);
    lobby[userId] = {
        ...userData
    }
    console.log("========== regenerateDoints process complete ==========");
}

function softResetPoints(userId) {
    const userData = lobby[userId];
    console.log("soft reset userData points doints balance",userData.userId, userData.points, userData.doints)
    const maxPoints = Math.floor((userData.balance + NOCOINERSTARTER) / POINTMULTI);
    const regeneratedPoints = (maxPoints / 18);
    console.log('soft reset regenerated calcualtion to subtract from doints', regeneratedPoints)
    userData.doints = Math.max(userData.points + userData.doints - regeneratedPoints, 0);
    console.log(`Points and doints reset: Points = ${userData.points}, Doints = ${userData.doints}`);
    lobby[userId] = {
        ...userData
    }
}

function shouldKick(userId) {
    const userData = lobby[userId];
    if(!lobby[userId].runs) return true
    return Date.now() - userData.runs[0].timeRequested > LOBBY_CLEAN_INTERVAL;
}

function addExp(userId) {
    const userData = lobby[userId];
    userData.exp += userData.points;
    userData.doints += userData.points;
    userData.boints = 0;
    userData.points = 0;
}

async function kick(userId) {
    const userData = lobby[userId];
    const kickedAt = Date.now();
    await writeUserData(parseInt(userId), {
        ...userData,
        points: 0,
        kickedAt,
    });
}


class LobbyManager {
    constructor(lobby) {
        this.lobby = lobby;
    }

    addUser(userId, userData) {
        //console.log('lobby before add', this.lobby);
        if (!this.lobby[userId]) {
            this.lobby[userId] = userData; // Directly assign the user data to the lobby
        }
        //console.log('lobby after add', this.lobby);
    }

    async cleanLobby() {
        console.log("========== Starting cleanLobby ==========");
        for (const userId in this.lobby){
            const userTmp = lobby[userId]
            console.log(userTmp.points,userTmp.doints,userTmp.qoints,userTmp.boints)
        }
        addPointsToAllUsers();
        console.log("Points added to all users. Starting user-by-user cleanup...");

        for (const userId in this.lobby) {
            const userData = this.lobby[userId]; // Fetch user data directly from the lobby
            console.log(`Processing userId: ${userId}`);

            if (userData) {
                console.log(`User ${userId} is valid. Checking if they should be kicked...`);

                if (shouldKick(userId)) {
                    console.log(`User ${userId} has been idle for too long. Adding experience and kicking them out.`);
                    addExp(userId); // Add experience to the user
                    softResetPoints(userId)
                    await this.kickUser(userId);
                    console.log(`User ${userId} has been kicked out.`);
                } else {
                    console.log(`User ${userId} is active. Adding experience and regenerating points.`);
                    addExp(userId); // Add experience to the user
                    softResetPoints(userId); // Regenerate doints
                    console.log(`User ${userId} experience added and points regenerated.`);
                }
            } else {
                console.error(`Invalid or undefined user detected: ${userId}. Removing from the lobby.`);
                delete this.lobby[userId];
            }
        }

        console.log("========== cleanLobby process complete ==========");
    }

    async kickUser(userId) {
        console.log(`Kicking userId: ${userId}`);
        await kick(userId); // Call the standalone `kick` function
        delete this.lobby[userId];
    }
}

const { getGroup } = require('./handlers/iGroup')

const lobbyManager = new LobbyManager(lobby);

// Adding users to the lobby as an example (this would come from actual interactions)
setInterval(async () => {
    await lobbyManager.cleanLobby();
}, LOBBY_CLEAN_INTERVAL); // This runs the lobby cleaning every N minutes

setInterval(initialize, DB_REFRESH); // This handles your DB refresh interval

//setInterval(cleanLobby, LOBBY_CLEAN_INTERVAL); //every N minutes
//setInterval(initialize, DB_REFRESH); //update burns, lora list etc from db
if(logLobby){setInterval(printLobby, 8*60*60*1000);} //every 8 hours
let locks = 0;


//10 images for a free user, 37 points a pop
//thats 370 points no multi
//how many images should an ms2 millionaire be able to make? 
//lets say a ms2 millionaire should be able to make 50 images in 8 hours
//50*37 = 1850 , 1000000 / 1850 = 540
//so with points multiplier of 540, if a million balance user makes 50 images, their multid points will exceed their balance of 1m
//540 * 370 = 199800, which fits nicely. but lets not give another 10 to our millionaires so easily
//40*37 = 1480 , 1M / 1480 = 675,
//nah i like it the other way better

//so what do you need to buy to get one more gen?
//if 37 * multi = 20k

function printLobby(){
    console.log(`\n CURRENT LOBBY \n`)
    console.log(Object.keys(lobby).length);
    console.log(timeTillTurnover(),' till clean')
    console.log(locks, ' locked until turnover');
        // Iterate over the keys of the lobby object
        Object.keys(lobby).forEach(userId => {
            const userData = lobby[userId];
            console.log(`\n`);
            console.log(`Wallet: ${userData.wallet}`);
            console.log(`Prompt: ${userData.prompt}`);
            console.log(`Points: ${userData.points}`);
        });
}

async function checkIn(message) {
    const userId = message.from.id;
    const group = getGroup(message);
    let balance = 0;

    // Check if the user is already in the lobby
    if (!lobby.hasOwnProperty(userId)) {
        let userData = await getUserDataByUserId(userId);
        //console.log('UserData in checkLobby (new user)', userData);
        if(!userData) {
            userData = await createDefaultUserData(userId)
        }
        // First, add the user to the lobby
        lobbyManager.addUser(userId, userData);
        //console.log(lobby)
        // Fetch and update the user's balance if they are verified
        if (userData.verified) {
            balance = await getBalance(userData.wallet);
            lobby[userId].balance = balance;
        }

        // Regenerate doints after the balance is updated
        if (userData.kickedAt) {
            console.log('Regenerating doints for kicked user');
            regenerateDoints(userId);
            // Remove the kickedAt key value after regenerating doints
            delete userData.kickedAt;
        }

        // Group credit check (could switch to qoints when ready)
        if (group && group.qoints > 0) {
            return true;
        }

        // Blacklist check
        if (checkBlacklist(userData.wallet)) {
            await sendMessage(message, 'You are on the blacklist.');
            return false;
        }

        setUserState(message, STATES.IDLE);
        console.log(`${message.from.first_name} has entered the chat.`);
    } else {
        const userData = lobby[userId]; // Access user data directly from the lobby

        // Group credit check
        if (group && group.credit > group.points) {
            return true;
        }

        // If the user's balance hasn't been fetched yet, retrieve it
        if (userData.verified && userData.balance === '') {
            const ms2Holding = await getBalance(userData.wallet);
            userData.balance = ms2Holding;
            balance = ms2Holding;
        } else {
            balance = userData.balance;
        }
        setUserState(message, STATES.IDLE);
    }

    return true;
}


async function checkLobby(message) {
    const userId = message.from.id;
    const group = getGroup(message);
    let balance = 0;

    // Check if the user is already in the lobby
    if (!lobby.hasOwnProperty(userId)) {
        let userData = await getUserDataByUserId(userId);
        //console.log('UserData in checkLobby (new user)', userData);
        if(!userData) {
            userData = await createDefaultUserData(userId)
        }
        // First, add the user to the lobby
        lobbyManager.addUser(userId, userData);

        // Fetch and update the user's balance if they are verified
        if (userData.verified) {
            balance = await getBalance(userData.wallet);
            lobby[userId].balance = balance;
        }

        // Regenerate doints after the balance is updated
        if (userData.kickedAt) {
            console.log('Regenerating doints for kicked user');
            regenerateDoints(userId);
            // Remove the kickedAt key value after regenerating doints
            delete userData.kickedAt;
        }

        // Group credit check (could switch to qoints when ready)
        if (group && group.qoints > 0) {
            return true;
        } else {
            console.log('not a group')
        }
//         create - make something
// effect - change something
// animate - movie maker
// status - check on the bot and see if its been reset lately
// regen - make what you just did again, or with your new settings you set
// set - change your generation settings
// signin - connect account
// signout - disconnect account
// seesettings - display what settings you have on your account
// accountsettings - change account settings
// savesettings - write your current account settings to my cpu so if the bot goes down you dont lose them
// resetaccount - return to default settings
// quit - exit a call and response ui
// getseed - capture the seed used on your last gen
// loralist - see what loras are available
// help - see help description
// ca - check chart buy

        // If the user is not verified, prompt them to sign in
        if (!userData.verified) {
            if (message.chat.id > 0) {
                const options = {
                    reply_markup: {
                        keyboard: [[{ text: '/signin' }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                };
                sendMessage(message, 'Use the signin command and connect a wallet to unlock $MS2 holder benefits.', options);
            }
            return true;
        }

        // Blacklist check
        if (checkBlacklist(userData.wallet)) {
            await sendMessage(message, 'You are on the blacklist.');
            return false;
        }

        setUserState(message, STATES.IDLE);
        console.log(`${message.from.first_name} has entered the chat.`);
    } else {
        const userData = lobby[userId]; // Access user data directly from the lobby

        // Group credit check
        if (group && group.qoints > 0) {
            return true;
        }

        // If the user's balance hasn't been fetched yet, retrieve it
        if (userData.verified && userData.balance === '') {
            const ms2Holding = await getBalance(userData.wallet);
            userData.balance = ms2Holding;
            balance = ms2Holding;
        } else {
            balance = userData.balance;
        }
        setUserState(message, STATES.IDLE);
    }

    // Check if the user has hit the generation limit
    const totalPoints = lobby[userId].points + (lobby[userId].doints || 0);
    const outOfPoints = (pointsCalc(totalPoints) > (balance + NOCOINERSTARTER)) 
    
    //if group and group qoints whatever
    //if outof points AND no qoints... 
    //if no qoints but have points left
    //not having qoints only matters if you also dont have points

    if (
        (outOfPoints && lobby[userId].qoints && lobby[userId].qoints <= 0 )
        ||
        (outOfPoints && !lobby[userId].qoints)
        ||
        (group && group.qoints <= 0)
    ) {
        const reacts = ["👎", "🤔", "🤯", "😱", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴", "🐳", "🌚", "🌭", "🤣", "🍌", "💔", "🤨", "😐", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "🙈", "😨", "🤗", "💅", "🤪", "🗿", "🆒", "🙉", "😘", "🙊", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"];
        const randomReact = reacts[Math.floor(Math.random() * reacts.length)];
        react(message, randomReact);
        const nextRegenTime = timeTillTurnover();
        const messageText = `🚫 You have hit your point limit! 
✨ Your points will regenerate every 15 minutes. (theoretically, dm art if they dont)
🔄 You'll regain some points in ${Math.ceil(nextRegenTime)} minutes.
💰 Want to continue now? Buy more MS2 and keep creating! 🥂
OR charge up your points directly 👾 with discounts for owning MS2 and using the bot!`;
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Buy 🛒', url: 'https://jup.ag/swap/SOL-AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg' },
                        { text: 'Chart 📈', url: 'https://www.dextools.io/app/en/solana/pair-explorer/3gwq3YqeBqgtSu1b3pAwdEsWc4jiLT8VpMEbBNY5cqkp?t=1719513335558' }
                    ],
                    [
                        { text: 'Charge ⚡️', url: 'https://miladystation2.net/charge'}
                    ]
                ]
            }
        };

        sendMessage(message, messageText, options);
        lobby[userId].balance = ''; // Reset balance after the limit is hit
        ++locks;
        return false;
    }

    return true;
}


function timeTillTurnover() {
    const currentTime = Date.now();
    const timePassed = currentTime - lastCleanTime;
    const minutesLeft = LOBBY_CLEAN_MINUTE - Math.floor((timePassed % (LOBBY_CLEAN_INTERVAL)) / (1000 * 60));

    return minutesLeft;
}
function pointsCalc(points) {
    return points * POINTMULTI;
}

module.exports =  {
    checkLobby, checkIn,
    //cleanLobby,
    lobbyManager,
    POINTMULTI,
    NOCOINERSTARTER,
    lastCleanTime,
    LOBBY_CLEAN_INTERVAL,
    LOBBY_CLEAN_MINUTE
}