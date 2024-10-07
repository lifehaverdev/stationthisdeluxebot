const { lobby, STATES } = require('./bot'); 
const { getUserDataByUserId, addPointsToAllUsers, writeUserData } = require('../../db/mongodb')
const { getBalance, checkBlacklist } = require('../users/checkBalance')
const { setUserState, sendMessage, react } = require('../utils');
const { initialize } =  require('./intitialize')
const { home } = require('../models/userKeyboards');
let lastCleanTime = Date.now();
const logLobby = true;
const POINTMULTI = 540;
const NOCOINERSTARTER = 199800;
const LOBBY_CLEAN_MINUTE = 15 ///minutes new rules //60 * 8;//8 hours
const LOBBY_CLEAN_INTERVAL = LOBBY_CLEAN_MINUTE * 60 * 1000; 
const DB_REFRESH = 1000*60*15


class User {
    constructor(userId, userData) {
        this.userId = userId;
        this.balance = userData.balance;
        this.points = userData.points || 0;
        this.doints = userData.doints || 0;
        this.exp = userData.exp || 0;
        this.kickedAt = userData.kickedAt || null;
        this.lastRunTime = userData.runs[0].timeRequested || null; // Last time the user made an action
    }

    //this is for kicked users?
    regenerateDoints() {
        if(!this.lastRunTime) return
        const maxPoints = Math.floor((this.balance + NOCOINERSTARTER) / POINTMULTI);
        const regenerationCycles = Math.floor((Date.now() - this.lastRunTime) / (1000 * 60 * 15)); // 15-minute cycles
        const regeneratedPoints = (maxPoints / 36) * regenerationCycles;

        // Subtract the regenerated points from the doints and ensure it doesn't drop below 0
        this.doints = Math.max(this.doints - regeneratedPoints, 0);
    }
    
    hitGenerationLimit() {
        const totalPoints = this.points + (this.doints || 0);
        return pointsCalc(totalPoints) > (this.balance + NOCOINERSTARTER);
    }

    softResetPoints() {
        // Reset points without kicking the user
        const maxPoints = Math.floor((this.balance + NOCOINERSTARTER) / POINTMULTI);
        const regeneratedPoints = (maxPoints / 36);

        this.doints = Math.max(this.doints - regeneratedPoints, 0);
    }

    shouldKick() {
        return Date.now() - this.lastRunTime > LOBBY_CLEAN_INTERVAL;
    }

    addExp() {
        this.exp += this.points;
        this.doints += this.points;
        this.points = 0;
    }

    async kick() {
        const kickedAt = Date.now()
        const userData = lobby[this.userId]
        await writeUserData(parseInt(this.userId), {
            ...userData,
            balance: this.balance,
            points: 0,
            doints: this.doints,
            kickedAt
        });
    }
}

class LobbyManager {
    constructor(lobby) {
        this.lobby = lobby;
    }

    addUser(userId, userData) {
        //console.log('lobby before add',lobby)
        if (!this.lobby[userId]) {
            //this.lobby[userId] = userData;
            const user = new User(userId, userData)
            Object.assign(user, userData)
            this.lobby[userId] = user;
        }
        //console.log('lobby after add',lobby)
    }

    async cleanLobby() {
        addPointsToAllUsers()
        for (const userId in this.lobby) {
            const user = this.lobby[userId];

            if (user && typeof user.shouldKick === 'function') {
                if (user.shouldKick()) {
                    user.addExp();
                    await this.kickUser(userId);
                } else {
                    user.addExp(); // Add experience to the user
                    user.softResetPoints(); // Regenerate doints
                }
            } else {
                // Log an error and kick out any undefined or invalid user
                console.error(`Invalid or undefined user detected: ${userId}. Kicking them out.`);
                delete this.lobby[userId]
            }
        }
    }

    async kickUser(userId) {
        const user = this.lobby[userId]
        await user.kick();
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

async function checkLobby(message) {
    const userId = message.from.id;
    const group = getGroup(message);
    let userData, balance = 0;

    if (!lobby.hasOwnProperty(userId)) {
        userData = await getUserDataByUserId(userId);

        if (userData.kickedAt) {
            const user = new User(userId, userData);
            user.regenerateDoints();
            lobbyManager.addUser(userId, userData);
        } else {
            lobbyManager.addUser(userId, userData);
        }

        if (group && group.credit > group.points) {
            return true;
        }

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
        } else {
            balance = await getBalance(userData.wallet);
        }

        if (checkBlacklist(userData.wallet)) {
            await sendMessage(message, 'You are on the blacklist.');
            return false;
        }

        lobby[userId].balance = balance;
        setUserState(message, STATES.IDLE);
        console.log(`${message.from.first_name} has entered the chat.`);
    } else {
        const user = lobby[userId];

        if (group && group.credit > group.points) {
            return true;
        }

        if (user.verified && user.balance == '') {
            const ms2holding = await getBalance(user.wallet);
            user.balance = ms2holding
            balance = ms2holding
        } else {
            balance = user.balance
        }
        setUserState(message, STATES.IDLE);
    }

    const user = lobby[userId];
    let totalPoints = user.points + (user.doints || 0);
    //console.log('balance after set user to lobby instance after checking balance for a different instance in a conditiona/',user.balance,balance)
    if (pointsCalc(totalPoints) > (balance + NOCOINERSTARTER) || (group && group.credit < group.points)) {
        const reacts = ["👎", "🤔", "🤯", "😱", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴", "🐳", "🌚", "🌭", "🤣", "🍌", "💔", "🤨", "😐", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "🙈", "😨", "🤗", "💅", "🤪", "🗿", "🆒", "🙉", "😘", "🙊", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"];
        const randomReact = reacts[Math.floor(Math.random() * reacts.length)];
        react(message, randomReact);

        const nextRegenTime = timeTillTurnover();
        const messageText = `🚫 You’ve hit your point limit! 
// ✨ Your points will regenerate every 15 minutes. 
// 🔄 You'll regain some points in ${Math.ceil(nextRegenTime)} minutes.
// 💰 Want to continue now? Buy more MS2 and keep creating! 🥂`
// //OR charge up your points directly 👾 with discounts for owning MS2 and using the bot!`;
    

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                    { text: 'Buy 🛒', url: 'https://jup.ag/swap/SOL-AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg' },
                    { text: 'Chart 📈', url: 'https://www.dextools.io/app/en/solana/pair-explorer/3gwq3YqeBqgtSu1b3pAwdEsWc4jiLT8VpMEbBNY5cqkp?t=1719513335558' }
                    ],
                    // [
//                 //     { text: 'Charge ⚡️', url: 'https://miladystation2.net/charge'}
//                 // ]
                ]
            }
        };

        sendMessage(message, messageText, options);
        user.balance = '';
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
    checkLobby,
    //cleanLobby,
    lobbyManager,
    POINTMULTI,
    NOCOINERSTARTER,
    lastCleanTime,
    LOBBY_CLEAN_INTERVAL,
    LOBBY_CLEAN_MINUTE
}