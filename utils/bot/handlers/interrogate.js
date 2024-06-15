const { sendMessage, setUserState, STATES } = require('../../utils')
const { getPhotoUrl } = require('../bot')
const { interrogateImage } = require('../../../commands/interrogate')

async function handleInterrogation(message) {
    sendMessage(message,'hmm what should i call this..');
    const photoUrl = await getPhotoUrl(message);
    try {
        //enqueueTask({message,promptObj})
        const{time,result} = await interrogateImage(message, photoUrl);
        sendMessage(message, result)
        setUserState(message,STATES.IDLE);
        return true
    } catch(err){
        console.log(err);
        return false
    }
}

module.exports = { handleInterrogation }