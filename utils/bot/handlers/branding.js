const fs = require('fs');
const { sendMessage, sendPhoto, setUserState, editMessage } = require('../../utils')
const { getPhotoUrl, STATES, lobby } = require('../bot')
const { addWaterMark, writeToDisc } = require('../../../commands/waterMark')


async function startDisc(message, user) {
    if(user){
        message.from.id = user;
        await editMessage({
            text: 'Send in the photo you want to write to a disc.',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
    } else {
        if(lobby[message.from.id] && lobby[message.from.id].balance < 200000){
            gated(message)
            return
        }
        sendMessage(message, 'Send in the photo you want to write to a disc.',{reply_to_message_id: message.message_id})
    }
    setUserState(message,STATES.DISC)
}

async function startWatermark(message, user) {
    if(user){
        message.from.id = user;
        await editMessage({
            text: 'Send in the photo you want to watermark.',
            chat_id: message.chat.id,
            message_id: message.message_id
        })
    } else {
        if(lobby[message.from.id] && lobby[message.from.id].balance < 200000){
            gated(message)
            return
        }
        sendMessage(message, 'Send in the photo you want to watermark.',{reply_to_message_id: message.message_id})
    }
    setUserState(message,STATES.WATERMARK)
}

async function handleDiscWrite(message) {
    sendMessage(message,'one sec..');
    chatId = message.chat.id;
    const userId = message.from.id;
    const fileUrl = await getPhotoUrl(message);
    
    try {
        const filenames = await writeToDisc(fileUrl)
        console.log(filenames)
        await sendPhoto(message, filenames[0]);
        //closeTask(userId,1,filenames,'DISC')
        fs.unlinkSync(filenames[0]);
        setUserState(message,STATES.IDLE);
        return true;
    } catch (err) {
        console.log(err);
        await sendMessage(message,'oh man something went horribly wrong. tell the dev');
        setUserState(message,STATES.IDLE);
        return false;
    }
}
async function handleWatermark(message) {
    sendMessage(message,`yes. this one needs a logo`)
    chatId = message.chat.id;
    const userId = message.from.id;
    const fileUrl = await getPhotoUrl(message);
    console.log('current lobby stats',lobby[userId].waterMark)
    try {
        const filenames = await addWaterMark(fileUrl,lobby[userId].waterMark)
        console.log('back in handleWatermark',filenames)
        await sendPhoto(message, filenames);
        //closeTask(userId,1,filenames,'WATERMARK')
        console.log(filenames)
        fs.unlinkSync(filenames);
        setUserState(message,STATES.IDLE);
        return true;
    } catch (err) {
        console.log(err);
        setUserState(message,STATES.IDLE);
        await sendMessage(message,'oh man something went horribly wrong');
        return false;
    }
}

module.exports = {
    handleWatermark,
    handleDiscWrite,
    startWatermark,
    startDisc
}