const { lobby, workspace, STATES } = require('../bot')
const { sendMessage, editMessage, setUserState } = require('../../utils')
const { createTraining } = require('../../../db/mongodb')
/*
LORA DATASET CREATION / CURATION

0. handleTrain
callback handler, the menu for displaying user created loras
in accountsettings, user hits TRAIN button
if they have any loras (found in their user object under the loras array, consisting of hash strings that can be referred to in db)
display each lora in paginated menu along with the newSet button that creates dataset entry in database
*/
async function getMyLoras(userId) {
    let loraKeyboardOptions = [];
    if (lobby[userId] && lobby[userId].loras && lobby[userId].loras.length > 0) {
        for (const loraIdHash of lobby[userId].loras) {
            try {
                const loraInfo = await loadLora(loraIdHash);
                workspace[loraIdHash] = loraInfo;
                loraKeyboardOptions.push({ text: `${loraInfo.name}`, callback_data: `el_${loraIdHash}` });
            } catch (error) {
                console.error(`Failed to load LoRa with ID ${loraIdHash}:`, error);
            }
        }
    }
    if (!(lobby[userId] && lobby[userId].loras && lobby[userId].loras.length >= 3)) {
        loraKeyboardOptions.push([{ text: 'New Lora', callback_data: 'newLora' }]);
    }
    return loraKeyboardOptions;
}

async function handleTrainingMenu(message, user) {
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const myLoras = await getMyLoras(message.from.id);
    const replyMarkup = {
        inline_keyboard: [
            [{ text: '↖︎', callback_data: 'accountSettingsMenu' }],
            ...myLoras,
            [{ text: 'cancel', callback_data: 'cancel' }]
        ]
    };
    const txt = '🌟Stationthisbot LoRa Training 🚂🦾';
    await editMessage({
        reply_markup: replyMarkup,
        chat_id: chatId,
        message_id: messageId,
        text: txt,
    });
}

/*
1. newLora
the handling for the callback in account menu , newSet
first need a name for the dataset, ask for that, 
callback -> setUserState(LORANAME) , sendMessage(hey what do you wanna call it)

handling for loraname state message recieved, 
create new lora db entry with a random hash id and the message.text name
add lora db hash to lobby[user].loras.push(hash) 
open dataset menu
*/

async function newLora(message) {
    const messageId = message.message_id;
    const chatId = message.chat.id;
    setUserState(message.reply_to_message, STATES.LORANAME)
    editMessage({
        text: 'What is the name of the LoRa?',
        message_id: messageId,
        chat_id: chatId
    })
}

async function createLora(message) {
    if(true){
        sendMessage(message,'🚂')
        setUserState(message,STATES.IDLE)
        return
    }
    const name = message.text;
    const hashId = Math.floor(10000000000000 * Math.random())
    console.log(hashId);
    
    const userContext = lobby[message.from.id]
    const thisLora = {
        loraId: hashId,
        name,
        images: [],
        captions: [],
        status: 'incomplete'
    }
    userContext.loras ? userContext.loras.push(thisLora.loraId) : userContext.loras = [thisLora.loraId]
    workspace[thisLora.loraId] = thisLora
    const success = await createTraining(thisLora)
    console.log(success)
    console.log(userContext.loras)
    setUserState(message,STATES.IDLE)
}

/*
2. removeLora
handles callback from datasetmenu
delete database entry, remove from userLoras list

3. datasetmenu
displays a paginated menu with a button representing each image&accompanying textfile in the set
if there is an image in the slot, use portrait emoji
if no image is in teh slot, use 📥
if theres a user written txtfile (prompt) add a 🔖

text on top of the menu message displays: loraStatus, completion percentage / strnegth , name , triggerWord(s)

4. slotEdit
callback for having clicked a slot in the datasetmenu,
if its an empty slot, user is just prompted for an image , setUserState(LORASLOTIMG)
if its a full slot, 
    create submenu with back button that goes back to datasetmenu
    button that allows you to see the image, where it references what is stored in the dataset, a telegram url for the file, send to the user
    if the image link is broken, it will redisplay the button to broken emoji 
    button that allows you to add your own caption, sendMessage(caption this image for your dataset, make sure to include the triggerword(s)), setUserState(LORASLOTTXT)
    button that erases the entry, it kicks you back out to the datsetmenu
5. handleSlotEdit
handler for LORASLOTIMG and LORASLOTTXT, saves whatever to the lora db entry for the slot

6. SUBMIT 
changes lora status from working to pending review

BACKEND

1. download dataset (safe? make sure only take pngs and txtfiles)
2. change status, change status from pending review to pending training to training 
3. change bot global training status to display to users that you are training a dataset for them rn


*/

module.exports = {
    handleTrainingMenu,
    newLora,
    createLora,
}