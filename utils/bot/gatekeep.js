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

const { getGroup } = require('./handlers/iGroup')

setInterval(cleanLobby, LOBBY_CLEAN_INTERVAL); //every N minutes
setInterval(initialize, DB_REFRESH); //update burns, lora list etc from db
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


async function cleanLobby() {
    //this saves all points to exp in the database
    addPointsToAllUsers()

    //now we adjust the user object to reflect the same
    for (const userId in lobby) {
        if (!userId) {
            // If userId is invalid or no valid runs array exists, delete the user from the lobby
            console.log(`Invalid or undefined userId found: ${userId}. Removing from lobby.`);
            delete lobby[userId];
            continue; // Skip to the next user
        }
        const max = Math.floor((lobby[userId].balance + NOCOINERSTARTER) / POINTMULTI);
        lobby[userId].exp += lobby[userId].points;

        // Calculate the regenerated points for this cycle
        let regeneratedPoints = max / 18;
        
        // Subtract regenerated points from the spent points (points), ensuring doints are non-negative
        let newDoints = 0;
        
        // If the user already has doints, add the new doints to the existing balance
        if (lobby[userId].doints) {
            newDoints = Math.max(lobby[userId].points + lobby[userId].doints - regeneratedPoints, 0);
        } else {
            newDoints = Math.max(lobby[userId].points - regeneratedPoints, 0);
        }

        // Update the user's doints and reset points to 0
        lobby[userId].doints = newDoints;
        lobby[userId].points = 0;

         // Check if the user has had any activity in the last 15 minutes
         
         const lastRunTime = lobby[userId].runs[0].timeRequested;
         if (Date.now() - lastRunTime > LOBBY_CLEAN_INTERVAL) {
             // Save user data and sign them out if no recent activity
             // Important that it saves the doints and points 
             // and a kickedAt key value we can refer to in the future 
             // to calculate further point regeneration
             const userData = lobby[userId]
             await writeUserData(parseInt(userId), {
                ...userData,
                points: 0,  // Use the most up-to-date points from the lobby
                doints: newDoints,
                kickedAt: Date.now(),
            });
            delete lobby[userId];
         }
    }
    
    locks = 0;
    console.log("The lobby is clear");
    lastCleanTime = Date.now(); // Update the last clean time
}
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

// async function checkLobby(message){
//     const userId = message.from.id
//     const group = await getGroup(message)
//     let balance;
//     let userData;

//     //if the user is not in the lobby
//     if(!lobby.hasOwnProperty(userId)){
//         //check db for settings
//         userData = await getUserDataByUserId(userId);
        
//             // If the user was previously signed out, calculate how much of their doints have regenerated
//             if (userData.kickedAt) {
//                 const timeSinceSignOut = Date.now() - userData.kickedAt;
//                 const minutesSinceSignOut = timeSinceSignOut / (1000 * 60);
//                 const regenerationCycles = Math.floor(minutesSinceSignOut / 15);
                
//                 const max = Math.floor((userData.balance + NOCOINERSTARTER) / POINTMULTI);
//                 const regeneratedPoints = max / 36 * regenerationCycles;

//                 // Reduce doints by the regenerated amount, but ensure it doesn't go below 0
//                 userData.doints = Math.max(userData.doints - regeneratedPoints, 0);
//             }

//         //check message for group
//         if(group){
//             if(group.credit > group.points){
//                 return true
//             }    
//         }
//         if(userData.wallet == '' || userData.verified == false){
//             if(message.chat.id < 0){
//                 sendMessage(message,'hi nice to meet you. 🥰');
//             } else {
//                 const options = {
//                     reply_markup: {
//                         keyboard: [[{ text: '/signin' }]],
//                         resize_keyboard: true,
//                         one_time_keyboard: true
//                     }
//                 }
//                 sendMessage(message,'use the signin command and connect a wallet to unlock $MS2 holder benefits',options);
//             }
//             balance = 0;
        
//         } else {
//             balance = await getBalance(userData.wallet);
//             let options;
//             if(message.chat.id > 0){
//                 options = {
//                     home
//                 }
//             }
            
//         }
       
//         if(checkBlacklist(userData.wallet)){
//             await sendMessage(message,`you are either on the blacklist or pretending to be the raydium pool lol gtfo`)
//             return false;
//         }
        
//         lobby[userId] = {
//             ...userData,
//             balance: balance,
//             points: 0
//         }
//         setUserState(message,STATES.IDLE);
//         console.log(message.from.first_name,"has entered the chat");
        
//     } else {
//         if(group){
//             if(group.credit > group.points){
//                 return true
//             }
//         }
//         if(lobby[userId].balance == '' && lobby[userId].wallet != '' && lobby[userId].verified == true){
//             lobby[userId].balance = await getBalance(lobby[userId].wallet);
//         }
//         setUserState(message,STATES.IDLE);
//     }
//     let points = lobby[userId].points;
//     if(lobby[userId].doints){points += lobby[userId].doints};
//     if (
//             pointsCalc(points) > lobby[userId].balance + NOCOINERSTARTER
//             || (group && group.credt < group.points)
//         ){
//         const reacts = ["👎", "🤔", "🤯", "😱", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴","🐳", "🌚", "🌭","🤣", "🍌", "💔", "🤨", "😐","💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "🙈", "😨", "🤗", "💅", "🤪", "🗿", "🆒", "🙉", "😘", "🙊", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"]
//         const which = Math.floor(Math.random() * reacts.length)
//         react(message,reacts[which])
//         sendMessage(message,`I am sorry, you have reached your limit, please try again in ${timeTillTurnover()}m \n\n\\.\\.\\. or \\.\\.\\. Buy${lobby[userId].balance > 0 ? ' more' : ''} MS2 🥂\n\n\`AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg\``,{parse_mode: 'MarkdownV2'})
//         lobby[userId].balance = '';
//         ++locks;
//         return false
//     }
//     return true;
// }

async function checkLobby(message) {
    const userId = message.from.id;
    const group = await getGroup(message);
    let userData, balance = 0;

    // Helper to regenerate doints if the user was signed out
    const regenerateDoints = (userData) => {
        if (userData.kickedAt) {
            const timeSinceSignOut = Date.now() - userData.kickedAt;
            const regenerationCycles = Math.floor(timeSinceSignOut / (1000 * 60 * 15)); // 15-minute cycles
            const maxPoints = Math.floor((userData.balance + NOCOINERSTARTER) / POINTMULTI);
            const regeneratedPoints = (maxPoints / 36) * regenerationCycles;

            userData.doints = Math.max(userData.doints - regeneratedPoints, 0); // Ensure it doesn't go below 0
        }
    };

    // Retrieve user data if not in lobby
    if (!lobby.hasOwnProperty(userId)) {
        userData = await getUserDataByUserId(userId);

        // Handle doints regeneration if kicked out
        regenerateDoints(userData);

        // Group credit check
        if (group && group.credit > group.points) {
            return true;
        }

        // Handle wallet and verification
        if ((!userData.wallet || !userData.verified) && message.chat.id < 0) {
            const options = {
                reply_markup: {
                    keyboard: [[{ text: '/signin' }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };
            sendMessage(message, 'Use the signin command and connect a wallet to unlock $MS2 holder benefits.', options);
            //let them pass the gatekeep and gen
            return true;
        }

        // Fetch user balance
        balance = await getBalance(userData.wallet);
        // Blacklist check
        if (checkBlacklist(userData.wallet)) {
            await sendMessage(message, 'You are either on the blacklist or pretending to be the raydium pool. GTFO.');
            return false;
        }

        // Add user to lobby with initial settings
        lobby[userId] = {
            ...userData,
            balance,
            points: 0
        };
        setUserState(message, STATES.IDLE);
        console.log(`${message.from.first_name} has entered the chat.`);
    } 
    else {
        // If user is already in the lobby
        userData = lobby[userId];

        // Group credit check
        if (group && group.credit > group.points) {
            return true;
        }

        // Update balance if necessary
        if (userData.wallet && userData.verified) {
            userData.balance = await getBalance(userData.wallet);
        }
        setUserState(message, STATES.IDLE);
    }

    // Calculate total points (regular points + doints)
    let totalPoints = lobby[userId].points + (lobby[userId].doints || 0);
    // Check if the user has exceeded their points limit
    if (pointsCalc(totalPoints) > (lobby[userId].balance + NOCOINERSTARTER) || (group && group.credit < group.points)) {
        const reacts = ["👎", "🤔", "🤯", "😱", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴", "🐳", "🌚", "🌭", "🤣", "🍌", "💔", "🤨", "😐", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "🙈", "😨", "🤗", "💅", "🤪", "🗿", "🆒", "🙉", "😘", "🙊", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"];
        const randomReact = reacts[Math.floor(Math.random() * reacts.length)];
        react(message, randomReact);
    
        // Calculate the time till the next regeneration cycle (15 minutes per cycle)
        const nextRegenTime = timeTillTurnover();
    
        const messageText = `🚫 You’ve hit your point limit! 
✨ Your points will regenerate every 15 minutes. 
🔄 You'll regain some points in ${Math.ceil(nextRegenTime)} minutes.
💰 Want to continue now? Buy more MS2 and keep creating! 🥂`
//OR charge up your points directly 👾 with discounts for owning MS2 and using the bot!`;
    
        // Button to buy MS2
        const options = {
            reply_markup: {
                inline_keyboard: [
                [
                    { text: 'Buy 🛒', url: 'https://jup.ag/swap/SOL-AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg' },
                    { text: 'Chart 📈', url: 'https://www.dextools.io/app/en/solana/pair-explorer/3gwq3YqeBqgtSu1b3pAwdEsWc4jiLT8VpMEbBNY5cqkp?t=1719513335558' },
                ],
                // [
                //     { text: 'Charge ⚡️', url: 'https://miladystation2.net/charge'}
                // ]
            ]
            }
        };
    
        sendMessage(message, messageText, options);
        userData.balance = '';
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
    cleanLobby,
    POINTMULTI,
    NOCOINERSTARTER,
    lastCleanTime,
    LOBBY_CLEAN_INTERVAL
}