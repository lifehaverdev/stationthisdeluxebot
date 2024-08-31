const { sendMessage, setUserState } = require('../../utils');
const { rooms, burns, getNextPeriodTime, startup, getBurned, lobby, STATES } = require('../bot')
const { features } = require('../../models/tokengatefeatures.js')
const { createRoom } = require('../../../db/mongodb.js')
const { initialize } = require('../intitialize.js');

function getGroup(message) {
    const group = rooms.find(group => group.id == message.chat.id)
    return group;
}

function groupSettings(message) {

    const group = getGroup(message);
    console.log(group)
    if(group == undefined){
        sendMessage(message,'This group is not initialized, would you like to apply a balance and become the bot boss?',
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {text: 'Yes, I am the boss', callback_data: 'createGroup'},
                            {text: 'No, I am but a hubmle genner', callback_data: 'cancel'}
                        ]
                    ]
                }
            }
        )
        return
    }
    //console.log('group found',group.name)
    let groupSettingsKeyboard = [
        [
            {text: 'Edit Group', callback_data: 'editgroup'},
        ],
        [
            {text: 'Apply Balance', callback_data: 'applygroupbalance'},
        ],
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
                url: 'https://miladystation2.net'
            }
        ]
    ];


    // if (group.applied >= 200000) {
    //     groupSettingsKeyboard[0].push(
    //         {
    //             text: `Watermark: ${group.settings.waterMark ? '✅' : '❌'}`,
    //             callback_data: 'toggleWaterMark',
    //         },
    //     );
    // }
    if(group.applied >= 400000){
        groupSettingsKeyboard[2].push(
            {
                text: `ControlNet ${group.settings.controlNet ? '✅' : '❌'}`,
                callback_data: 'toggleControlNet',
            },
            {
                text: `Style Transfer ${group.settings.styleTransfer ? '✅' : '❌'}`,
                callback_data: 'toggleStyleTransfer',
            }
        )
    }
    // if(group.applied >= 500000){
    //     groupSettingsKeyboard[2].push(
    //         {
    //             text: `Voice Menu`,
    //             callback_data: 'voicemenu',
    //         },
    //     )
    // }
    //console.log('groupchat message',message);
    
    let groupSettingsInfo = '\n';
    groupSettingsInfo += `<b>${group.name}</b> \n`;
    groupSettingsInfo += `<b>MS2 Burn Balance:</b> ${group.applied}🎮\n`;
    groupSettingsInfo += `<b>Points Remaining</b> ${group.credits - group.points}\n`
    //groupSettingsInfo += `<b>LEVEL:</b>${level} `
    //groupSettingsInfo += `<b>EXP:</b> ${bars}\n`
    //groupSettingsInfo += `<b>Next Points Period in ${getNextPeriodTime(startup)}m</b>\n\n`
    groupSettingsInfo += `<b>Locked Features:</b>\n`;
    
    // List locked features based on the user's balance
    const lockedFeatures = features.filter(feature => group.applied < feature.gate);
    if (lockedFeatures.length > 0) {
        lockedFeatures.forEach(feature => {
            groupSettingsInfo += `<b>-</b> ${feature.gate} $MS2: ${feature.name}\n`;
        });
    } else {
        groupSettingsInfo += `None\n`;
    }

    // Send account settings menu with account information
    sendMessage(message, groupSettingsInfo, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: groupSettingsKeyboard
        }
    });
    
}

/*
Needs to be updated so anyone can request to 
*/
function handleApplyBalance(message) {
    const burned = getBurned(message.from.id);
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
    } else {
        if(group.admin.includes(message.from.id) || group.owner == message.from.id){
            group.applied = parseInt(value)
            sendMessage(message,'nice you just added some more burn to the pile')
        }
    }
}

function handleGroupName(message) {
    const userId = message.from.id
    lobby[userId].group = message.text;
    const burnRecord = burns.find(burn => burn.wallet == lobby[message.from.id].wallet);
    let burned = 0;
    if (burnRecord) {
        console.log(burnRecord.burned)
        burned += parseInt(burnRecord.burned) * 2 / 1000000;
    }
    sendMessage(message.reply_to_message,`You have burned a total of ${burned} MS2, tell me how much you would like to apply to this group`)
    setUserState(message.reply_to_message, STATES.GROUPAPPLY)
}

async function createGroup(message) {
    const owner = message.from.id;
    const chat = message.chat.id;
    await createRoom(chat,owner,message.text);
    await initialize();
    //const group = rooms.find(group => group.id == message.chat.id)
    setUserState(message,STATES.IDLE)
    groupSettings(message);
}

module.exports = {
    groupSettings,
    handleApplyBalance,
    handleGroupName,
    getGroup
}