const { sendMessage, setUserState } = require('../../utils')
const { getPhotoUrl, STATES, lobby } = require('../bot')
//const { interrogateImage } = require('../../../commands/interrogate');
const { enqueueTask } = require('../queue');

async function handleInterrogation(message) {
    sendMessage(message,'hmm what should i call this..');
    const photoUrl = await getPhotoUrl(message);
    try {
        const promptObj = {
            ...lobby[message.from.id],
            fileUrl: photoUrl,
            type: 'INTERROGATE'
        }
        //enqueueTask({message,promptObj})
        //const{time,result} = await interrogateImage(message, photoUrl);
        enqueueTask({message, promptObj})
        //sendMessage(message, result)
        setUserState(message,STATES.IDLE);
        return true
    } catch(err){
        console.log(err);
        return false
    }
}

module.exports = { handleInterrogation }