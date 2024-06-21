const home =  {
    reply_markup: {
        keyboard: [
            [{ text: '/create' },{ text: '/effect' }],
            [{ text: '/animate' },{ text: '/status'}],
            [{ text: '/set' },{text: '/regen' }],
            [{ text: '/accountsettings' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
}

const justSet = {
    reply_markup: {
        keyboard: [
            [{ text: '/regen' },{ text: '/status' }],
            [{ text: '/accountsettings' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
}

const signedOut = {
    reply_markup: {
        keyboard: [
            [{ text: '/signin' }],
            [{ text: '/help' }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
}

module.exports = {
    home,
    justSet,
    signedOut
}