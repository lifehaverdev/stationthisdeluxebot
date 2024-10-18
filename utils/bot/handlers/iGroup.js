const { sendMessage, setUserState, makeBaseData, compactSerialize } = require('../../utils');
const { rooms, getBurned, lobby, STATES } = require('../bot')
const { features } = require('../../models/tokengatefeatures.js')
const { createRoom, writeData, writeBurnData } = require('../../../db/mongodb.js')
const { initialize } = require('../intitialize.js');

function getGroup(message) {
    const group = rooms.find(group => group.id == message.chat.id)
    return group;
}

function groupSettings(message) {
    baseData = makeBaseData(message,message.from.id);
    const group = getGroup(message);
    if(!group){
        console.log('handling groupname','message',message.text)
        handleGroupName(message);
        console.log('exiting groupSettings')
        return
    }
    let groupSettingsKeyboard = [
        // [
        //     {text: 'Edit Group', callback_data: 'editgroup'},
        // ],
        // [
        //     {text: 'Apply Balance', callback_data: 'applygroupbalance'},
        // ],
        [],
        [
            {
                text: 'Chart', 
                url: 'https://www.dextools.io/app/en/solana/pair-explorer/3gwq3YqeBqgtSu1b3pAwdEsWc4jiLT8VpMEbBNY5cqkp?t=1719513335558'
            },
            {
                text: 'Buy',
                url: 'https://jup.ag/swap/SOL-AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg'
            },
            {
                text: 'Charge',
                url: 'https://miladystation2.net/charge'
            }
        ]
    ];

    
    let groupSettingsInfo = '\n';
    groupSettingsInfo += `<b>${group.name}</b> \n`;
    //groupSettingsInfo += `<b>MS2 Burn Balance:</b> ${group.qoints}🎮\n`;
    groupSettingsInfo += `<b>Points Remaining</b> ${group.qoints}\n`

    // List locked features based on the user's balance
    // const lockedFeatures = features.filter(feature => group.wallet < feature.gate);
    // if (lockedFeatures.length > 0) {
    //     groupSettingsInfo += `<b>Limited Access</b>\n`;
    //     // lockedFeatures.forEach(feature => {
    //     //     groupSettingsInfo += `<b>-</b> ${feature.gate} $MS2: ${feature.name}\n`;
    //     // });
    // } else {
    //     groupSettingsInfo += `Full Access VIP GROUP\n`;
    // }

    // Send account settings menu with account information
    sendMessage(message, groupSettingsInfo, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: groupSettingsKeyboard
        }
    });
    
}

function handleGroupName(message) {
    console.log('handling group name')
    console.log(message)
    const userId = message.from.id
    lobby[userId].group = message.chat.title;
    const burned = getBurned(userId)/2
    const msg = `You have burned a total of ${burned} MS2, tell me how much you would like to apply to this group`
    console.log('i would be saying this now'+msg)
    sendMessage(message,msg)
    setUserState(message, STATES.GROUPAPPLY)
    console.log('now the user',userId,' state is ',lobby[userId].state)
}

/*
Needs to be updated so anyone can request to 
*/
async function handleApplyBalance(message) {
    console.log('handling apply balance')
    const burned = getBurned(message.from.id)/2;
    const value = message.text;
    const group = getGroup(message);
    if (isNaN(value)) {
        sendMessage(message, 'Please enter a valid integer');
        return
    }
    console.log('value',value,'burned',burned)
    if(parseInt(value) > burned || burned == undefined){
        sendMessage(message,'Hey you never burned that much MS2 in ur life, try again')
        return
    }
    if(parseInt(value) < 100000){
        sendMessage(message,'yea thats not really worth it btw, try again')
        return
    }
    if(group == undefined){
        createGroup(message)
        await writeBurnData(message.from.id,parseInt(value))
        setUserState(message,STATES.IDLE)
    } else {
        if(group.owner == message.from.id || (group.admin.length > 0 && group.admin.includes(message.from.id))){
            group.applied += parseInt(value)
            await writeData('floorplan',{id: message.chat.id},{applied: group.applied})
            await writeBurnData(message.from.id,parseInt(value))
            sendMessage(message,'nice you just added some more burn to the pile')
            setUserState(message,STATES.IDLE)
        }
    }
}

async function createGroup(message) {
    console.log('creating group')
        // Check if any room has an owner that matches the current message's owner
        if (rooms.some(room => room.owner === message.from.id)) {
            console.log('Owner already has a group');
            sendMessage(message,'you are already group owner')
            return; // Exit the function if the owner already has a group
        }
    const owner = message.from.id;
    const chat = message.chat.id;
    await createRoom(chat,owner,message.text);
    await initialize();
    //const group = rooms.find(group => group.id == message.chat.id)
    setUserState(message,STATES.IDLE)
    groupSettings(message);
}

async function toggleAdmin(message) {
    const group = getGroup(message);
    if(!group) return
    if(message.from.id != group.owner || !group.admins.includes(message.from.id)) return
    if(group && group.admins.length > 0
        && group.admins.includes(message.reply_to_message.from.id)
    ) {
        group.admins = group.admins.filter(adminId => adminId !== message.reply_to_message.from.id);
        react(message,'✍️');
        //return; // Exit the function after removing the admin
    } else {
        group.admins.push(message.reply_to_message.from.id);
        react(message,"💅");
        //return
    }
    await writeData('floorplan',{id: message.chat.id},{admins: group.admins})
    console.log('rewrote the room')
}

module.exports = {
    groupSettings,
    handleApplyBalance,
    handleGroupName,
    getGroup,
    createGroup,
    toggleAdmin
}