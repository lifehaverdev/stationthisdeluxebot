const { lobby, STATES } = require('./bot'); 
// Old MongoDB imports (commented out for reference)
// const { getUserDataByUserId, addPointsToAllUsers, writeUserData, createDefaultUserData } = require('../../db/mongodb')

// New database models
const { UserCore, UserEconomy, UserPref } = require('../../db/index');
const { fetchUserCore, fetchFullUserData } = require('../../db/operations/userFetch');
const { initializeNewUser } = require('../../db/operations/newUser');
const { addPointsToAllUsers } = require('../../db/operations/batchPoints');
const { repairSingleUser } = require('../../db/operations/repairUsers');

const userCore = new UserCore();
const userEconomy = new UserEconomy();
const userPref = new UserPref();

const { getBalance, checkBlacklist, getNFTBalance } = require('../users/checkBalance')
const { setUserState, sendMessage, react } = require('../utils');
const { initialize } =  require('./intitialize')
const {defaultUserData,validateUserData} = require('../users/defaultUserData')
const { AnalyticsEvents } = require('../../db/models/analyticsEvents');
const analytics = new AnalyticsEvents();

//const { home } = require('../models/userKeyboards');
let lastCleanTime = Date.now();
const logLobby = true;
const POINTMULTI = 540;
const NOCOINERSTARTER = 199800;
const LOBBY_CLEAN_MINUTE = 15 ///minutes new rules //60 * 8;//8 hours
const LOBBY_CLEAN_INTERVAL = LOBBY_CLEAN_MINUTE * 60 * 1000; 
const DB_REFRESH = 1000*60*15

//User class standalone methods that are now functions becasue user class was useless
function regenerateDoints(userId) {
    const userData = lobby[userId];
    
    if (!userData.kickedAt) {
        console.log("$$$ [${userId}] | Status: Skipped - No kickedAt timestamp | userdata balance points doints",userData.balance, userData.points, userData.doints);
        return;
    }

    const timeSinceLastRun = Date.now() - userData.kickedAt;
    const maxPoints = calculateMaxPoints(userData.balance);
    const regenerationCycles = Math.floor(timeSinceLastRun / (LOBBY_CLEAN_INTERVAL));
    const regeneratedPoints = (maxPoints / 18) * regenerationCycles;
    const oldDoints = userData.doints;
    
    userData.doints = Math.max(oldDoints - regeneratedPoints, 0);
    
    console.log(`$$$ [${userId}] Rejoins the fray | Time: ${Math.floor(timeSinceLastRun / 1000)}s | Cycles: ${regenerationCycles} | Balance: ${userData.balance} | Doints: ${oldDoints} → ${userData.doints} | MaxPoints: ${maxPoints}`);
    
    lobby[userId] = {
        ...userData
    }
}

function calculateMaxPoints(balance) {
    return Math.floor((balance + NOCOINERSTARTER) / POINTMULTI);
}

function softResetPoints(userId) {
    const userData = lobby[userId];
    const maxPoints = calculateMaxPoints(userData.balance);
    const regeneratedPoints = (maxPoints / 18);
    const oldDoints = userData.doints;

    userData.doints = Math.max(userData.doints - regeneratedPoints, 0);
    
    console.log(`$$$ SoftReset [${userId}] | Balance: ${userData.balance} | Doints: ${oldDoints} → ${userData.doints} | MaxPoints: ${maxPoints} | Regenerated: ${regeneratedPoints}`);
    
    lobby[userId] = {
        ...userData
    }
}

function shouldKick(userId) {
    const userData = lobby[userId];

    // If no user data exists in the lobby, kick the user
    if (!userData) {
        console.log(`User ${userId} not found in the lobby. Kicking.`);
        return true;
    }

    // New users ("newb") are exempt from being kicked
    // if (userData.newb) {
    //     console.log(`User ${userId} is a newb and won't be kicked.`);
    //     return false;
    // }
    // i think this made it so that newbs didnt regen points. lets just save them

    // Check lastTouch timestamp
    const now = Date.now();
    const lastTouch = userData.lastTouch || 0; // Fallback to 0 if lastTouch is missing
    const timeSinceLastTouch = now - lastTouch;

    console.log(
        `Evaluating kick for userId ${userId}:`,
        `lastTouch=${new Date(lastTouch).toISOString()}`,
        `timeSinceLastTouch=${timeSinceLastTouch}ms`,
        `LOBBY_CLEAN_INTERVAL=${LOBBY_CLEAN_INTERVAL}ms`
    );

    // Kick if time since last interaction exceeds the lobby clean interval
    if (timeSinceLastTouch > LOBBY_CLEAN_INTERVAL) {
        console.log(`User ${userId} is inactive. Kicking.`);
        return true;
    }

    console.log(`User ${userId} is active and will not be kicked.`);
    return false;
}


function addExp(userId) {
    const userData = lobby[userId];
    userData.exp += userData.points;
    userData.doints += userData.points;
    userData.boints = 0;
    userData.points = 0;
}

async function kick(userId) {
    const userData = lobby[userId];
    if (!userData) {
        console.error(`Attempted to kick userId ${userId} but no userData found in lobby`);
        return;
    }

    try {
        // First get existing data from database
        const coreData = await fetchUserCore(userId);
        if (!coreData) {
            console.error(`No core data found for userId ${userId} during kick`);
            return;
        }

        const updatedData = {
            ...coreData,  // Base from core data
            ...lobby[userId],  // Overlay with lobby data
            kickedAt: Date.now(),
            lastTouch: userData.lastTouch,
            state: userData.state
        };

        // If user is verified, get and include full data
        if (coreData.verified) {
            const fullData = await fetchFullUserData(userId);
            if (fullData) {
                // Preserve the current session's preferences by only filling in missing fields
                // rather than overwriting everything
                Object.assign({}, fullData, updatedData); // Prioritize updatedData over fullData
                
                // Alternative approach: Save current state to database before kicking
                // await saveUserPreferences(userId, updatedData);
                // Object.assign(updatedData, fullData);
            }
        }

        // Write to all relevant collections
        try {
            await userCore.writeUserData(userId, updatedData);
            await userEconomy.writeUserData(userId, updatedData);
            await userPref.writeUserData(userId, updatedData);
            await analytics.trackUserKick(userId, updatedData.username);
            console.log(`Kicked user ${userId} with preserved data`);
        } catch (writeError) {
            console.error(`Error writing data during kick for userId ${userId}:`, writeError);
        }

    } catch (error) {
        console.error(`Error during kick operation for userId ${userId}:`, error);
    }
}

async function batchKick(userIds) {
    console.log(`Starting batch kick for ${userIds.length} users`);
    
    try {
        // 1. Gather all user data from lobby
        const usersData = userIds.map(userId => ({
            userId,
            lobbyData: lobby[userId]
        })).filter(data => data.lobbyData); // Filter out any missing lobby data

        // 2. Fetch all core data in parallel
        const coreDataPromises = usersData.map(({ userId }) => fetchUserCore(userId));
        const coreDataResults = await Promise.all(coreDataPromises);
        
        // 3. Prepare verified users' full data fetches
        const verifiedUsers = coreDataResults
            .map((core, index) => ({ core, userData: usersData[index] }))
            .filter(data => data.core?.verified);
        
        const fullDataPromises = verifiedUsers.map(({ userData }) => 
            fetchFullUserData(userData.userId)
        );
        const fullDataResults = await Promise.all(fullDataPromises);

        // 4. Prepare final data for all users
        const kickData = usersData.map(({ userId, lobbyData }, index) => {
            const coreData = coreDataResults[index];
            if (!coreData) return null;

            const baseData = {
                ...coreData,
                ...lobbyData,
                kickedAt: Date.now(),
                lastTouch: lobbyData.lastTouch,
                state: lobbyData.state
            };

            // If user was verified, merge with full data
            if (coreData.verified) {
                const fullData = fullDataResults[verifiedUsers.findIndex(v => v.userData.userId === userId)];
                if (fullData) {
                    Object.assign({}, fullData, baseData);
                }
            }

            return {
                userId,
                data: baseData
            };
        }).filter(Boolean); // Remove any null entries

        // 5. Batch write to all collections
        const writePromises = kickData.flatMap(({ userId, data }) => [
            userCore.writeUserData(userId, data),
            userEconomy.writeUserData(userId, data),
            userPref.writeUserData(userId, data),
            analytics.trackUserKick(userId, data.username)
        ]);

        await Promise.all(writePromises);
        
        // 6. Clean up lobby
        userIds.forEach(userId => delete lobby[userId]);

        console.log(`Successfully batch kicked ${kickData.length} users`);
        return true;

    } catch (error) {
        console.error('Error during batch kick operation:', error);
        return false;
    }
}


class LobbyManager {
    constructor(lobby) {
        this.lobby = lobby;
    }

    addUser(userId, userData) {
        //console.log('lobby before add', this.lobby);
        if (!this.lobby[userId]) {
            this.lobby[userId] = userData; // Directly assign the user data to the lobby
        }
        //console.log('lobby after add', this.lobby);
    }

    async cleanLobby() {
        console.log("========== Starting cleanLobby ==========");
        
        try {
            const didwe = await addPointsToAllUsers(lobby);
            console.log("Points added to all users: ", didwe);

            const usersToKick = [];
            const usersToUpdate = [];

            // First, process all users and sort them into kick/update arrays
            for (const userId in lobby) {
                try {
                    const userData = lobby[userId];
                    if (!userData) continue;

                    const should = shouldKick(userId);
                    if (should) {
                        console.log(`Queuing user ${userId} for kick`);
                        addExp(userId);
                        softResetPoints(userId);
                        usersToKick.push(userId);
                    } else {
                        console.log(`Queuing points update for user ${userId}`);
                        addExp(userId);
                        softResetPoints(userId);
                        usersToUpdate.push(userId);
                    }
                } catch (error) {
                    console.error(`Error processing user ${userId}:`, error);
                }
            }

            // Update the cleanLobby section to use batchKick
            if (usersToKick.length > 0) {
                console.log(`Batch kicking ${usersToKick.length} users`);
                await batchKick(usersToKick);
            }

            console.log(`Processed ${usersToKick.length} kicks and ${usersToUpdate.length} updates`);
        } catch (error) {
            console.error("Error in cleanLobby:", error);
        }
    }

    async kickUser(userId) {
        console.log(`Kicking userId: ${userId}`);
        await kick(userId); // Call the standalone `kick` function
        delete this.lobby[userId];
    }
}

const { getGroup } = require('./handlers/iGroup');
const { get } = require('https');

const lobbyManager = new LobbyManager(lobby);

// Adding users to the lobby as an example (this would come from actual interactions)
setInterval(async () => {
    await lobbyManager.cleanLobby();
}, LOBBY_CLEAN_INTERVAL); // This runs the lobby cleaning every N minutes

setInterval(initialize, DB_REFRESH + (7.5 * 60 * 1000)); // This handles your DB refresh interval

//setInterval(cleanLobby, LOBBY_CLEAN_INTERVAL); //every N minutes
//setInterval(initialize, DB_REFRESH); //update burns, lora list etc from db
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

async function checkIn(message) {
    const userId = message.from.id;

    if (!(await handleUserData(userId, message))) {
        await react(message,"👻")
        return false;
    }
    console.log('setting user to idle')
    setUserState(message, STATES.IDLE);
    console.log(`${message.from.first_name} is checked in.`);
    return true;
}

const CACHE_EXPIRY_TIME = 1000 * 60 * 60 * 24; //1 day expiry on asset balance cache

// Function to calculate user's maximum points
function calculateMaxPoints(balance) {
    return Math.floor((balance + NOCOINERSTARTER) / POINTMULTI);
}

// Function to handle group-specific logic
async function handleGroupCheck(group, userId, message) {
    if (group) {
        const { qoints, gateKeeping } = group;

        // Check if group has qoints or pointAccounting mode
        if (qoints <= 0 && gateKeeping?.pointAccounting === 'house') {
            // Group pays qoints, but has none left
        
            await sendMessage(
                message,
                'Hey, this group is out of qoints. You can /donate some if you have any, or continue in DMs. If you dont have any, go to the stationthisbot site'
            );
            return false;
        
        } else if (
            qoints <= 0 &&
            gateKeeping?.pointAccounting === 'user' &&
            lobby[userId]?.points < calculateMaxPoints(lobby[userId]?.balance || 0)
        ) {
            // User pays qoints, but doesn't have enough
            await sendMessage(
                message,
                'You don’t have enough points to generate here and the group is out of balance. Earn or top up your points to proceed.'
            );
            return false;
        }

        // Gatekeeping logic
        if (gateKeeping) {
            const { style, token, nft, minBalance, Msg, chosen, admins } = gateKeeping;

            if ((style === 'token' && token) || (style === 'nft' && nft)) {
                if (lobby[userId]?.verified) {
                    const assetKey = gateKeeping[style];
                    let assetData = lobby[userId]?.assets?.[assetKey] || null;

                    if (!assetData || (Date.now() - assetData.checked) > CACHE_EXPIRY_TIME) {
                        const tokenBal =
                            style === 'token'
                                ? await getBalance(lobby[userId]?.wallet, assetKey)
                                : await getNFTBalance(lobby[userId]?.wallet, assetKey);

                        if (!lobby[userId]?.assets) {
                            lobby[userId].assets = {};
                        }

                        lobby[userId].assets[assetKey] = {
                            bal: tokenBal,
                            checked: Date.now(),
                        };
                        assetData = lobby[userId].assets[assetKey];
                    }

                    if (assetData?.bal > minBalance) {
                        return true;
                    } else {
                        await sendMessage(message, Msg);
                        await analytics.trackAssetCheck(userId, userData.username, 'token_balance', true, {
                            balance: tokenBal,
                            wallet: userData.wallet
                        });
                        return false;
                    }
                } else {
                    await sendMessage(message, `I don't know you. ` + Msg);
                    await analytics.trackGatekeeping(message, 'unverified_group_tokengate_reject', {
                        wallet: userData.wallet
                    });
                    return false;
                }
            } else if (style === 'select') {
                if (chosen?.includes(userId) || admins?.includes(userId)) {
                    return true;
                } else {
                    await sendMessage(message, Msg);
                    await analytics.trackGatekeeping(message, 'group_select_gate_reject', {
                        wallet: userData.wallet
                    });
                    return false;
                }
            } else if (style === 'adminOnly') {
                if (admins?.includes(userId) || userId === DEV_DMS) {
                    // Allow if user is an admin or matches DEV_DMS
                    return true;
                } else {
                    await sendMessage(message, Msg);
                    await analytics.trackGatekeeping(message, 'admin_only_access', {
                        groupTitle: group.title
                    });
                    return false;
                }
            } else if (style === 'none') {
                return true;
            }
        }

        return true; // Default allow if no specific gatekeeping logic is defined
    }

    return true; // Allow if no group is provided
}


async function handleUserData(userId, message) {
    ///console.log(`Handling user data for userId: ${userId}`);

    try {
        // Check if the user is already in the lobby
        if (!lobby.hasOwnProperty(userId)) {
            let userData;
            let existingCore;
            // First try to fetch existing user data
            try {
                existingCore = await fetchUserCore(userId);
                
                if (existingCore) {
                    // User exists, get full data
                    userData = await fetchFullUserData(userId);
                    const validatedData = validateUserData(userData);
                    // Check if validation made any changes
                    const userDataKeys = Object.keys(userData).length;
                    const validatedDataKeys = Object.keys(validatedData).length;

                    // Only save if we're adding new fields (validatedData has more keys)
                    if (validatedDataKeys > userDataKeys) {
                        console.log('New fields detected, saving validated data');
                        await userCore.writeUserData(userId, validatedData);
                        await userEconomy.writeUserData(userId, validatedData);
                        await userPref.writeUserData(userId, validatedData);
                    } else if (JSON.stringify(userData) !== JSON.stringify(validatedData)) {
                        console.log('Data cleanup only, skipping save');
                    }
                    userData = validatedData;
                    userData.createSwitch = 'MAKE';
                    // console.log('userData', JSON.stringify(userData))
                    await analytics.trackUserJoin(userId, message.from.username); // Track first time user
                } else {
                    // No existing user, create new
                    console.log(`No existing user data found for userId ${userId}, creating new...`);
                    react(message, "🤝");
                    userData = await initializeNewUser(userId);
                    if (!userData) {
                        throw new Error("Failed to create new user data.");
                    }
                    const validatedData = validateUserData(userData);const userDataKeys = Object.keys(userData).length;
                    const validatedDataKeys = Object.keys(validatedData).length;

                    // Only save if we're adding new fields (validatedData has more keys)
                    if (validatedDataKeys > userDataKeys) {
                        console.log('New fields detected, saving validated data');
                        await userCore.writeUserData(userId, validatedData);
                        await userEconomy.writeUserData(userId, validatedData);
                        await userPref.writeUserData(userId, validatedData);
                    } else if (JSON.stringify(userData) !== JSON.stringify(validatedData)) {
                        console.log('Data cleanup only, skipping save');
                    }
                    userData = validatedData;
                    await analytics.trackUserJoin(userId, message.from.username, true); // Track first time user
                }
            } catch (error) {
                console.error(`DB fetch error for userId ${userId}:`, {
                    errorType: error.name,
                    errorMessage: error.message
                });
                
                // Add user to lobby but mark them as having a failed DB fetch
                lobby[userId] = {
                    ...defaultUserData,
                    userId,
                    dbFetchFailed: true,
                    lastDbFetchAttempt: Date.now()
                };
                
                await sendMessage(message, 'Unable to verify account status. Your actions may be limited until connection is restored.');
                return false;
            }

            // Add user to the lobby
            lobbyManager.addUser(userId, userData);
            console.log(`User ${userId} added to the lobby.`);

            // Fetch balance if user is verified
            if (userData.verified) {
                try {
                    const balance = await getBalance(userData.wallet);
                    lobby[userId].balance = balance;
                    console.log(`User ${userId} balance updated: ${balance}`);
                } catch (error) {
                    console.warn(`Failed to fetch balance for userId ${userId}:`, error);
                    lobby[userId].balance = 0; // Default balance
                }
            }

            // Handle returning users
            if (userData.kickedAt) {
                console.log(`User ${userId} is returning. Regenerating points.`);
                regenerateDoints(userId);
                delete userData.kickedAt; // Remove kickedAt
            }

            // Check blacklist
            if (checkBlacklist(userData.wallet)) {
                await sendMessage(message, 'You are on the blacklist.');
                await analytics.trackGatekeeping(message, 'blacklisted', {
                    wallet: userData.wallet
                });
                return false;
            }

            // Track user activity
            lobby[userId].lastTouch = Date.now();

            // Set user state to IDLE
            setUserState(message, STATES.IDLE);
            console.log(`${message.from.first_name} has entered the chat.`);
            await analytics.trackUserJoin(userId, message.from.username, !existingCore);
        } else {
            // User is already in the lobby
            if (lobby[userId].dbFetchFailed) {
                // If it's been more than 5 minutes since last attempt, try fetching again
                const timeSinceLastAttempt = Date.now() - (lobby[userId].lastDbFetchAttempt || 0);
                if (timeSinceLastAttempt > 5 * 60 * 1000) {
                    try {
                        const userData = await initializeNewUser(userId);
                        if (userData) {
                            delete lobby[userId].dbFetchFailed;
                            delete lobby[userId].lastDbFetchAttempt;
                            lobby[userId] = { ...userData, lastTouch: Date.now() };
                            await sendMessage(message, 'Your account status has been restored.');
                        }
                    } catch (error) {
                        lobby[userId].lastDbFetchAttempt = Date.now();
                        return false;
                    }
                } else {
                    return false; // Still in failed state, not time to retry yet
                }
            }
            
            // Update lastTouch as normal
            lobby[userId].lastTouch = Date.now();
            if(lobby[userId].balance == '' && lobby[userId].verified) {
                try {
                    const balance = await getBalance(lobby[userId].wallet);
                    lobby[userId].balance = balance;
                    console.log(`User ${userId} balance updated: ${balance}`);
                } catch (error) {
                    console.warn(`Failed to fetch balance for userId ${userId}:`, error);
                    lobby[userId].balance = 0; // Default balance
                }
            }
            console.log(`${new Date(lobby[userId].lastTouch)} Updated lastTouch for userId ${userId} ${message.from.username}`);
        }
    } catch (error) {
        console.error(`Error handling user data for userId ${userId}:`, error);
        return false;
    }

    return true;
}


// Function to handle balance and points check
async function checkUserPoints(userId, group, message) {
    console.log('checking user points')
    const user = lobby[userId];
    const totalPoints = user.points + (user.doints || 0);
    const outOfPoints = pointsCalc(totalPoints) > (user.balance + NOCOINERSTARTER);

    if (
        (outOfPoints && user.qoints <= 0) || 
        (outOfPoints && !user.qoints) || 
        (group && group.gateKeeping.style == 'house' && group.qoints <= 0) ||
        (group && group.gateKeeping.style == 'user' && user.qoints <0 && outOfPoints && group.qoints <=0) 
    ) {
        const reacts = ["👎", "🤔", "🤯", "😱", "🤬", "😢", "🤮", "💩", "🤡", "🥱", "🥴", "🐳", "🌚", "🌭", "🤣", "🍌", "🤨", "😐", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "🙈", "😨", "🤗", "💅", "🤪", "🗿", "🆒", "🙉", "😘", "🙊", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"];
        const randomReact = reacts[Math.floor(Math.random() * reacts.length)];
        react(message, randomReact);

        const nextRegenTime = timeTillTurnover();
        const messageText = `🚫 You have hit your point limit!\n✨ Your points will regenerate every 15 minutes. (theoretically, dm art if they don’t)\n🔄 You'll regain some points in ${Math.ceil(nextRegenTime)} minutes.\n💰 Want to continue now? Buy more MS2 and keep creating! 🥂 OR charge up your points directly 👾 with discounts for owning MS2 and using the bot!`;
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Buy 🛒', url: 'https://jup.ag/swap/SOL-AbktLHcNzEoZc9qfVgNaQhJbqDTEmLwsARY7JcTndsPg' },
                        { text: 'Chart 📈', url: 'https://www.dextools.io/app/en/solana/pair-explorer/3gwq3YqeBqgtSu1b3pAwdEsWc4jiLT8VpMEbBNY5cqkp?t=1719513335558' }
                    ],
                    [
                        { text: 'Charge ⚡️', url: 'https://miladystation2.net/charge' }
                    ]
                ]
            }
        };

        sendMessage(message, messageText, options);
        user.balance = '';
        ++locks;
        await analytics.trackGatekeeping(message, 'points_limit', {
            totalPoints,
            balance: user.balance,
            qoints: user.qoints
        });
        return false;
    }
    return true;
}

// Main lobby check function
async function checkLobby(message) {
    const userId = message.from.id;
    const group = getGroup(message);

    if (!(await handleUserData(userId, message))) {
        return false;
    }

    if (!(await handleGroupCheck(group, userId, message))) {
        return false;
    }

    if (!await checkUserPoints(userId, group, message)) {
        return false;
    }

    setUserState(message, STATES.IDLE);
    console.log(`${message.from.first_name} is ready.`);
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
    checkLobby, checkIn,
    //cleanLobby,
    calculateMaxPoints,
    lobbyManager,
    POINTMULTI,
    NOCOINERSTARTER,
    lastCleanTime,
    LOBBY_CLEAN_INTERVAL,
    LOBBY_CLEAN_MINUTE
}