const fs = require('fs');
const { sendMessage, sendPhoto, setUserState } = require('../../utils')
const { getPhotoUrl, STATES } = require('../bot')
const { addWaterMark, writeToDisc } = require('../../../commands/waterMark')

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
    try {
        const filenames = await addWaterMark(fileUrl)
        console.log('back in handleWatermark',filenames)
        await sendPhoto(message, filenames[0]);
        //closeTask(userId,1,filenames,'WATERMARK')
        fs.unlinkSync(filenames[0]);
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
    handleDiscWrite
}