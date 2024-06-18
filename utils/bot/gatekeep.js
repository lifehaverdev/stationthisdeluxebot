const { lobby, STATES, rooms } = require('./bot'); 
const { getUserDataByUserId } = require('../../db/mongodb')
const { getBalance, checkBlacklist } = require('../users/checkBalance')
const { setUserState, sendMessage } = require('../utils')
const logLobby = true;
let lastCleanTime = Date.now();
let startup = Date.now()
const POINTMULTI = 666;
const NOCOINERSTARTER = 16666;
setInterval(cleanLobby, 2 * 60 * 60 * 1000); //every hour
if(logLobby){setInterval(printLobby, 6*60*60*1000);} //every 6 hours


function cleanLobby() {
    for (const userId in lobby) {
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

    if(rooms.some((group) => {
        if(group.chat.id == message.chat.id) return true
    })){return true}

    if(!lobby.hasOwnProperty(userId)){
        userData = await getUserDataByUserId(userId);
        if(userData.wallet == '' || userData.verified == false){
            if(message.chat.id < 0){
                sendMessage(message,'dm me the signin command and connect a wallet to unlock $MS2 holder benefits');
            } else {
                sendMessage(message,'use the signin command and connect a wallet to unlock $MS2 holder benefits');
            }
            balance = 0;
            //return false
        } else {
            balance = await getBalance(userData.wallet);
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
        const welcomeMessage = `welcome, been here for ${(Date.now() - startup)/1000} seconds now`
        sendMessage(message, welcomeMessage);
        //return true
    // } else if (lobby[userId].verified === false) {
    //     sendMessage(message,'You must be verified to use the bot. Try signout and signin to complete the verify process.')
    } else {
        if(lobby[userId].balance == '' && lobby[userId].wallet != '' && lobby[userId].verified == true){
            lobby[userId].balance = await getBalance(lobby[userId].wallet);
        }
        setUserState(message,STATES.IDLE);
    }
    let points = lobby[userId].points;
    if (pointsCalc(points) > lobby[userId].balance + NOCOINERSTARTER){
        sendMessage(message,`I am sorry, you have reached your limit, please try again in ${timeTillTurnover()}m`)
        ++locks;
        return false
    }
    return true;
}
function timeTillTurnover() {
    const currentTime = Date.now();
    const timePassed = currentTime - lastCleanTime;
    const minutesLeft = 60 - Math.floor((timePassed % (1000 * 60 * 60)) / (1000 * 60));

    return minutesLeft;
}
function pointsCalc(points) {
    return points * POINTMULTI;
}

module.exports =  {
    checkLobby
}