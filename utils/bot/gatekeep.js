const { lobby, STATES, rooms, startup } = require('./bot'); 
const { getUserDataByUserId, addPointsToAllUsers } = require('../../db/mongodb')
const { getBalance, checkBlacklist } = require('../users/checkBalance')
const { setUserState, sendMessage, react } = require('../utils');
const { home } = require('../models/userKeyboards');
const logLobby = true;
let lastCleanTime = Date.now();
// let startup = Date.now()
const POINTMULTI = 540;
const NOCOINERSTARTER = 199800;
const LOBBY_CLEAN_MINUTE = 60 * 8;//8 hours
const LOBBY_CLEAN_INTERVAL = LOBBY_CLEAN_MINUTE * 60 * 1000; 

setInterval(cleanLobby, LOBBY_CLEAN_INTERVAL); //every N minutes
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


function cleanLobby() {
    for (const userId in lobby) {
        addPointsToAllUsers()
        lobby[userId].exp += lobby[userId].points
        lobby[userId].points = 0;
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
async function checkLobby(message){
    const userId = message.from.id
    
    let balance;
    let userData;



    if(!lobby.hasOwnProperty(userId)){
        userData = await getUserDataByUserId(userId);
        if(rooms.some((group) => {
            if(group.chat.id == message.chat.id) return true
        })){return true}
        if(userData.wallet == '' || userData.verified == false){
            if(message.chat.id < 0){
                sendMessage(message,'dm me the signin command and connect a wallet to unlock $MS2 holder benefits');
            } else {
                const options = {
                    reply_markup: {
                        keyboard: [[{ text: '/signin' }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
                sendMessage(message,'use the signin command and connect a wallet to unlock $MS2 holder benefits',options);
            }
            balance = 0;
            //return false
        } else {
            balance = await getBalance(userData.wallet);
            let options;
            if(message.chat.id > 0){
                options = {
                    home
                }
            }
            //sendMessage(message, 'welcome back', options);
        }
        // if(userData.verified === false){
        //     if(message.chat.id < 0){
        //         sendMessage(message,'Unlock the full features of the bot by signing in and verifying')
        //     //return false
        // }
        if(checkBlacklist(userData.wallet)){
            await sendMessage(message,`you are either on the blacklist or pretending to be the raydium pool lol gtfo`)
            return false;
        }
        
        lobby[userId] = {
            ...userData,
            balance: balance,
            points: 0
        }
        setUserState(message,STATES.IDLE);
        console.log(message.from.first_name,"has entered the chat");
        //const welcomeMessage = `welcome, been here for ${(Date.now() - startup)/1000} seconds now`
        //sendMessage(message, welcomeMessage);
        //return true
    // } else if (lobby[userId].verified === false) {
    //     sendMessage(message,'You must be verified to use the bot. Try signout and signin to complete the verify process.')
    } else {
        if(lobby[userId].balance == '' && lobby[userId].wallet != '' && lobby[userId].verified == true){
            lobby[userId].balance = await getBalance(lobby[userId].wallet);
        }
        if(rooms.some((group) => {
            if(group.chat.id == message.chat.id) return true
        })){return true}
        setUserState(message,STATES.IDLE);
    }
    let points = lobby[userId].points;
    if (pointsCalc(points) > lobby[userId].balance + NOCOINERSTARTER){
        const reacts = ["👎", "❤", "🥰", "🤔", "🤯", "😱", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴","🐳", "🌚", "🌭","🤣", "🍌", "💔", "🤨", "😐","💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "🙈", "😇", "😨", "🤗", "💅", "🤪", "🗿", "🆒", "🙉", "😘", "🙊", "😎", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"]
        const which = Math.floor(Math.random() * reacts.length)
        react(message,reacts[which])
        sendMessage(message,`I am sorry, you have reached your limit, please try again in ${timeTillTurnover()}m \n\n\\.\\.\\. or \\.\\.\\. Buy${lobby[userId].balance > 0 ? ' more' : ''} MS2 🥂\n\n\`AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg\``,{parse_mode: 'MarkdownV2'})
        lobby[userId].balance = '';
        ++locks;
        return false
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
    NOCOINERSTARTER
}