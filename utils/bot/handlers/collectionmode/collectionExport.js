const { studio, prefixHandlers, STATES, stateHandlers, lobby } = require('../../bot');
const { CollectionDB } = require('../../../../db/index');
const StudioDB = require('../../../../db/models/studio');
const { sendMessage, editMessage, sendDocument, setUserState, safeExecute } = require('../../../utils');
const { getOrLoadCollection, getCollectionGenerationCount } = require('./collectionUtils');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const axios = require('axios');

prefixHandlers['export_'] = handleExportMenu

async function handleExportMenu(action, message, user) {
    // Split action into pieces by underscore
    const actionPieces = action.split('_');
    const collectionExport = new CollectionExport();
    // console.log('handleExportMenu',action, message, user)
    switch (actionPieces[1]) {
        case 'menu':
            await collectionExport.showExportMenu(message, user);
            break;
        case 'select':
            await collectionExport.handleExportSelection(action, message, user);
            break;
        case 'images':
            await collectionExport.handleExportSelectionImages(action,message, user);
            break;
        case 'next':
            await collectionExport.handleExportNextStep(action,message, user);
            break;
        case 'platform':
            await collectionExport.handleExportSelectionPinned(action,message, user);
            break;
        case 'cancel':
            await collectionExport.handleExportCancel(message, user);
            break;
        default:
            console.log('default',action)
            break;
    }
}

class CollectionExport {
    async showExportMenu(message, user) {
        try {
            const collections = await this.getExportableCollections(user);
            const keyboard = [];

            // Group exported collections by timestamp
            const exportGroups = new Map(); // timestamp -> collections[]
            collections.exported.forEach(collection => {
                const timestamp = collection.exportedAt.toString();
                if (!exportGroups.has(timestamp)) {
                    exportGroups.set(timestamp, []);
                }
                exportGroups.get(timestamp).push(collection);
            });

            // Show new collections first
            if (collections.new.length > 0) {
                collections.new.forEach(collection => {
                    keyboard.push([{
                        text: `🖼️ ${collection.name} (${collection.pieceCount} pieces)`,
                        callback_data: `export_select_${collection.collectionId}`
                    }]);
                });
            }

            // Add metadata generation buttons for each export group
            if (exportGroups.size > 0) {
                for (const [timestamp, groupCollections] of exportGroups) {
                    const date = new Date(parseInt(timestamp)).toLocaleDateString();
                    const collectionNames = groupCollections.map(c => c.name).join(", ");
                    keyboard.push([{
                        text: `🔗 ${date} - ${collectionNames}`,
                        callback_data: `export_next_${timestamp}`
                    }]);
                }
            }

            keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);

            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: "🎁 Export Collections\n\n" +
                    "Export new collections or generate metadata for previous exports:",
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });

        } catch (error) {
            console.error('Error showing export menu:', error);
            await sendMessage({
                message,
                text: "❌ An error occurred while preparing the export menu."
            });
        }
    }

    async getExportableCollections(userId) {
        const collectionDb = new CollectionDB();
        
        // Get all collections for user
        const collections = await collectionDb.getCollectionsByUserId(userId);
        const exportable = {
            new: [],      // Collections never exported
            exported: []  // Collections previously exported
        };

        // Check each collection for generated pieces and export status
        for (const collection of collections) {
            const pieceCount = await getCollectionGenerationCount(collection.collectionId);

            if (pieceCount > 0) {
                const collectionWithCount = {
                    ...collection,
                    pieceCount,
                    lastExported: collection.exportedAt ? new Date(collection.exportedAt).toLocaleDateString() : null
                };

                if (collection.exportedAt) {
                    exportable.exported.push(collectionWithCount);
                } else {
                    exportable.new.push(collectionWithCount);
                }
            }
        }

        return exportable;
    }
    async handleExportSelection(action, message, user) {
        const collectionId = parseInt(action.split('_')[2]);
        
        // Initialize studio context for user if it doesn't exist
        if (!studio[user]) {
            studio[user] = {};
        }

        // Initialize export context if it doesn't exist
        if (!studio[user].exportContext) {
            studio[user].exportContext = {
                collections: new Set(),
                format: null,
                metadata: null
            };
        }

        // Toggle selection
        if (studio[user].exportContext.collections.has(collectionId)) {
            studio[user].exportContext.collections.delete(collectionId);
        } else {
            studio[user].exportContext.collections.add(collectionId);
        }

        // Update menu to show selection
        await this.updateExportMenu(message, user);
    }

    async updateExportMenu(message, user) {
        const collections = await this.getExportableCollections(user);
        const selectedIds = studio[user].exportContext?.collections || new Set();
        const keyboard = [];

        // Add new collections section if any exist
        if (collections.new.length > 0) {
            keyboard.push([{ 
                text: "🆕 New Collections to Export:", 
                callback_data: "export_header_new" 
            }]);
            
            collections.new.forEach(collection => {
                keyboard.push([{
                    text: `${selectedIds.has(collection.collectionId) ? '✅' : '🖼️'} ${collection.name} (${collection.pieceCount} pieces)`,
                    callback_data: `export_select_${collection.collectionId}`
                }]);
            });
        }

        // Add previously exported collections section if any exist
        if (collections.exported.length > 0) {
            
            collections.exported.forEach(collection => {
                keyboard.push([{
                    text: `${selectedIds.has(collection.collectionId) ? '✅' : '🖼️'} ${collection.name} (${collection.pieceCount} pieces) - Last: ${collection.lastExported}`,
                    callback_data: `export_select_${collection.collectionId}`
                }]);
            });
        }

        // Add action buttons
        if (selectedIds.size > 0) {
            keyboard.push([
                { text: "📦 Continue", callback_data: "export_images" },
                { text: "❌ Cancel", callback_data: "cancel" }
            ]);
        } else {
            // Add metadata option if there are exported collections
            if (collections.exported.length > 0) {
                keyboard.push([{ 
                    text: "🔗 Generate Metadata (Need IPFS/Arweave URL)", 
                    callback_data: "export_next" 
                }]);
            }
            keyboard.push([{ text: "❌ Cancel", callback_data: "cancel" }]);
        }

        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: "🎁 Export Collections\n\n" +
                "Select collections to export images, or generate metadata for previously exported collections:",
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    }
    async handleExportSelectionImages(action, message, user) {
        // Initialize metrics
        const metrics = {
            startTime: performance.now(),
            totalBytes: 0,
            batches: [],  // Will hold info for each batch
            currentBatch: {
                pieces: 0,
                bytes: 0,
                downloadTimes: []
            }
        };
        
        const logMetric = (checkpoint, data = {}) => {
            const used = process.memoryUsage();
            console.log(`[EXPORT_METRICS] ${checkpoint}:`, {
                timeMs: Math.round(performance.now() - metrics.startTime),
                memoryMB: Math.round(used.heapUsed / 1024 / 1024),
                ...data
            });
        };
        try {
            logMetric('export_start');
            // Get selected collections from studio context
            if (!studio[user]?.exportContext?.collections?.size) {
                logMetric('export_no_collections');
                await sendMessage({
                    message,
                    text: "❌ No collections selected for export."
                });
                return;
            }

            // Show processing message
            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: "⏳ Preparing your collections export...\nThis may take a few minutes."
            });

            //
            //SECTION 1: Fetch and update pieces
            //
            // Get approved pieces
            const studioDb = new StudioDB();
            const selectedCollections = Array.from(studio[user].exportContext.collections);

            let allPieces = [];
            const exportTimestamp = Date.now();

            for (const collectionId of selectedCollections) {
                //fetch pieces from db
                const pieces = await studioDb.findMany({
                    collectionId,
                    status: { $in: ['approved', 'pending_review'] }
                });
                
                allPieces = [...allPieces, ...pieces];
            }
            
            console.log('allPieces',allPieces.length)
            // Shuffle all pieces
            const shuffledPieces = allPieces.sort(() => Math.random() - 0.5);
            
            studioDb.startBatch();
            // Assign and save export numbers
            for (let i = 0; i < shuffledPieces.length; i++) {
                const piece = shuffledPieces[i];
                const exportNumber = i + 1;
                // Get the export timestamp from the first piece (they all have the same timestamp)
                

                // Save export number to piece document
                // Add update operation to batch
                studioDb.batchOperations.push(collection => 
                    collection.updateOne(
                        { _id: piece._id },
                        { 
                            $set: { 
                                export: {
                                    number: exportNumber,
                                    timestamp: exportTimestamp
                                }
                            }
                        }
                    )
                );
                
                /// Update the piece in our array with the export number
                shuffledPieces[i] = { ...piece, exportNumber };
            }
            // Execute all updates in one batch
            await studioDb.executeBatch();

            //
            //SECTION 2: Download images
            //
            const MAX_BATCH_SIZE = 1.95 * 1024 * 1024 * 1024; // 1.95GB in bytes
            let currentBatchSize = 0;
            let currentBatchNumber = 1;
            let batchStartIndex = 1;
            // Create temp directory for this export
            const exportDir = path.join(__dirname, '../../../../temp', `export_${user}`);
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            // Create first batch directory
            let currentBatchDir = path.join(exportDir, `batch_${currentBatchNumber}`);
            fs.mkdirSync(currentBatchDir, { recursive: true });


            // Download and rename images
            let currentIndex = 1;
            for (const piece of shuffledPieces) {
                const imageUrl = piece.files[0]?.url; // Assuming first file is the image
                if (imageUrl) {
                    try {
                        // Check file size first
                        const headResponse = await axios.head(imageUrl);
                        const fileSize = parseInt(headResponse.headers['content-length']) || 0;

                        // If adding this file would exceed batch size, zip and send current batch
                        if (currentBatchSize + fileSize > MAX_BATCH_SIZE) {
                            // Zip and send current batch
                            const batchZipPath = await createAndSendBatch(
                                currentBatchDir, 
                                currentBatchNumber, 
                                message, 
                                batchStartIndex
                            );

                            // Cleanup current batch
                            fs.rmSync(currentBatchDir, { recursive: true, force: true });
                            fs.unlinkSync(batchZipPath);

                            // Prepare for next batch
                            currentBatchNumber++;
                            currentBatchSize = 0;
                            batchStartIndex = currentIndex;
                            
                            // Create new batch directory
                            currentBatchDir = path.join(exportDir, `batch_${currentBatchNumber}`);
                            fs.mkdirSync(currentBatchDir, { recursive: true });
                        }

                        const response = await axios({
                            url: imageUrl,
                            responseType: 'stream'
                        })

                        // Save with numeric filename
                        const imagePath = path.join(currentBatchDir, `${currentIndex}.png`);
                        const writer = fs.createWriteStream(imagePath);
                        response.data.pipe(writer);

                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });
                    

                        currentBatchSize += fileSize;
                        currentIndex++;

                    } catch (error) {
                        console.error('Error downloading image:', error);
                        continue;
                    }
                }
            }

            if (currentBatchSize > 0) {
                const finalBatchZipPath = await createAndSendBatch(
                    currentBatchDir, 
                    currentBatchNumber, 
                    message, 
                    batchStartIndex
                );
                
                // Cleanup final batch
                fs.rmSync(currentBatchDir, { recursive: true, force: true });
                fs.unlinkSync(finalBatchZipPath);
            }

            //
            //SECTION 5: Cleanup
            //
            fs.rmSync(exportDir, { recursive: true, force: true });
            const collectionDb = new CollectionDB();
            // Update all selected collections with the export timestamp
            for (const collectionId of studio[user].exportContext.collections) {
                await collectionDb.updateOne(
                    { collectionId: collectionId },
                    { 
                        exportedAt: exportTimestamp
                    }
                );
            }

            // Clear export context
            delete studio[user].exportContext;

            logMetric('export_complete', {
                totalBatches: currentBatchNumber,
                totalPieces: shuffledPieces.length
            });

            // Send completion message with next steps
            await editMessage({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: "🎉 Your collections have been exported successfully!\n\n" +
                    "🚀 Choose your launch platform:\n\n" +
                    "Different platforms have different requirements for metadata:",
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: "ScatterArt - Insta Reveal",
                            callback_data: `export_platform_scatter_instant_${exportTimestamp}`
                        }],
                        [{
                            text: "ScatterArt - Custom Reveal",
                            callback_data: `export_platform_scatter_custom_${exportTimestamp}`
                        }],
                        [{
                            text: "LaunchMyNFT",
                            callback_data: `export_platform_launchmynft_${exportTimestamp}`
                        }],
                        [{
                            text: "Self-Hosted (Advanced)",
                            callback_data: `export_platform_custom_${exportTimestamp}`
                        }],
                        [{
                            text: "❌ Cancel",
                            callback_data: "cancel"
                        }]
                    ]
                }
            });

        } catch (error) {
            console.error('Error handling export:', error);
            await sendMessage({
                message,
                text: "❌ An error occurred during export. Please try again."
            });
        }
    }
    async handleExportNextStep(action, message, user) {
        // Store export timestamp from action
        const exportTimestamp = action.split('_')[2];
        
        if (!studio[user]) {
            studio[user] = {};
        }
        
        studio[user].exportIntent = {
            timestamp: exportTimestamp,
            status: 'pending'
        };

        // Show platform selection menu
        await editMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: "🚀 Choose your launch platform:\n\n" +
                  "Different platforms have different requirements for metadata:",
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: "ScatterArt - Insta Reveal",
                        callback_data: `export_platform_scatter_instant_${exportTimestamp}`
                    }],
                    [{
                        text: "ScatterArt - Custom Reveal",
                        callback_data: `export_platform_scatter_custom_${exportTimestamp}`
                    }],
                    [{
                        text: "LaunchMyNFT",
                        callback_data: `export_platform_launchmynft_${exportTimestamp}`
                    }],
                    [{
                        text: "Self-Hosted (Advanced)",
                        callback_data: `export_platform_custom_${exportTimestamp}`
                    }],
                    [{
                        text: "❌ Cancel",
                        callback_data: "cancel"
                    }]
                ]
            }
        });
    }
    async handleExportSelectionPinned(action, message, user) {
        const platform = action.split('_')[2];
        const exportTimestamp = action.split('_')[3];
        const studioDb = new StudioDB();
        if (!studio[user]) {
            studio[user] = {};
        }

        switch (platform) {
            case 'launchmynft':
                if (!studio[user]) studio[user] = {};
                studio[user].launchMyNFT = {
                    timestamp: exportTimestamp,
                    status: 'awaiting_name',
                    collections: await studioDb.findMany({
                        exportedAt: parseInt(exportTimestamp)
                    })
                };

                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: "Let's set up how your NFTs will appear on marketplaces! 📝\n\n" +
                          "First, what name should appear before each NFT number?\n\n" +
                          "Examples:\n" +
                          "• 'Milady' → Milady #1, Milady 2, etc.\n" +
                          "To get the first you would respond with 'Milady #'\n\n" +
                          "Type your preferred collection piece name:",
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "❌ Cancel", callback_data: "export_cancel" }
                        ]]
                    }
                });

                // Set state to handle user input
                setUserState(
                    { ...message, from: { id: user } },
                    STATES.SETEXPORT
                );
                break;

            case 'scatter_instant':
            case 'scatter_custom':
            case 'custom':
                // For all other platforms, we need hosting URL first
                studio[user].mustprovidepinnedaddress = {
                    timestamp: exportTimestamp,
                    platform: platform,
                    status: 'pending'
                };

                setUserState(
                    { ...message, from: { id: user } },
                    STATES.SETEXPORT
                );

                await editMessage({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: "🔗 Please provide the base URL where your images are hosted:\n\n" +
                        "Examples:\n" +
                        "• IPFS: ipfs://QmYourHash/\n" +
                        "• Arweave: https://arweave.net/YourHash/\n" +
                        "• Other: https://your-hosting.com/collection/\n\n" +
                        "Make sure the URL ends with a forward slash (/)",
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "❌ Cancel", callback_data: "cancel" }
                        ]]
                    }
                });
                break;
        }
    }
    
}

async function createAndSendBatch(batchDir, batchNumber, message, startIndex) {
    const zipName = `images_batch_${batchNumber}.zip`;
    const zipPath = path.join(batchDir, '..', zipName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

    archive.pipe(output);
    
    const files = fs.readdirSync(batchDir);
    files.forEach(file => {
        if (file.endsWith('.png')) {
            archive.file(path.join(batchDir, file), { name: file });
        }
    });

    await new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
        archive.finalize();
    });

    // Send batch message and file
    await sendMessage(
        message,
        `Sending batch ${batchNumber} (images ${startIndex}-${startIndex + files.length - 1})...`
    );

    await sendDocument(message, zipPath, {
        caption: `Batch ${batchNumber} - Images ${startIndex}-${startIndex + files.length - 1}`
    });

    return zipPath;
}

stateHandlers[STATES.SETEXPORT] = (message) => safeExecute(message, handleSetExport);

async function handleSetExport(message) {
    const user = message.from.id;
    try {
        // Check if we're expecting a pinned address
        if (studio[user]?.mustprovidepinnedaddress) {
            const baseUrl = message.text.trim();
            
            // Basic URL validation
            if (!baseUrl.endsWith('/')) {
                await sendMessage({
                    message,
                    text: "❌ URL must end with a forward slash (/)\nPlease try again:"
                });
                return;
            }

            // Transform IPFS URL if needed
            
            let testUrl;
            if (baseUrl.startsWith('ipfs://')) {
                const ipfsHash = baseUrl.replace('ipfs://', '').replace('/', '');
                testUrl = `${process.env.PINATA_PREPEND}${ipfsHash}/1.png${process.env.PINATA_APPEND}`;
            } else {
                testUrl = `${baseUrl}1.png`;
            }

            // Test URL by attempting to fetch first image
            try {
                console.log('testUrl',testUrl)
                // Get collections from this export timestamp
                const studioDb = new StudioDB();
                const collections = await studioDb.findMany({
                    exportedAt: parseInt(studio[user].mustprovidepinnedaddress.timestamp)
                });

                // Try to fetch the first image (1.png)
                const response = await axios.head(testUrl);
                
                if (response.status !== 200) {
                    throw new Error('Image not accessible');
                }

                // URL is valid, store it and show metadata format options
                studio[user].mustprovidepinnedaddress.status = 'validated';
                studio[user].mustprovidepinnedaddress.baseUrl = baseUrl;

                // Show metadata format selection
                await sendMessage(
                    message,
                    "✅ URL validated successfully!\n\n" +
                        "Choose your metadata format:",
                    {reply_markup: {
                        inline_keyboard: [
                            [{ 
                                text: "ETH (Standard ERC721)", 
                                callback_data: "export_metadata_eth" 
                            }],
                            [{ 
                                text: "SOL (Metaplex)", 
                                callback_data: "export_metadata_sol_metaplex" 
                            }],
                            [{ 
                                text: "SOL (Core)", 
                                callback_data: "export_metadata_sol_core" 
                            }],
                            [{ 
                                text: "SOL (CNFT)", 
                                callback_data: "export_metadata_sol_cnft" 
                            }],
                            [{ 
                                text: "❌ Cancel", 
                                callback_data: "cancel" 
                            }]
                        ]
                    }}
                );

            } catch (error) {
                console.error('URL validation error:', error);
                await sendMessage(
                    message,
                    "❌ Could not validate URL. Please ensure:\n" +
                    "1. The URL is accessible\n" +
                    "2. Image files are named as numbers (1.png, 2.png, etc.)\n" +
                    "3. You have proper permissions set\n\n" +
                    "Please try again:"
                );
            }
        }

        if(studio[user]?.launchMyNFT) {
            const context = studio[user].launchMyNFT;
            const response = message.text.trim();

            switch (context.status) {
                case 'awaiting_name':
                    context.name = response;
                    context.status = 'awaiting_symbol';
                    
                    await sendMessage(
                        message,
                        "Great! Now we need a symbol (ticker) for your collection.\n" +
                        "Example: 'BAYC' for Bored Apes\n\n" +
                        "Type your collection symbol (2-5 characters):"
                    );
                    break;

                case 'awaiting_symbol':
                    if (response.length < 2 || response.length > 5) {
                        await sendMessage(
                            message,
                            "Symbol must be 2-5 characters.\nPlease try again:"
                        );
                        return;
                    }
                    
                    context.symbol = response.toUpperCase();
                    context.status = 'awaiting_description';
                    
                    await sendMessage(
                        message,
                        "Perfect! Finally, provide a description for your collection.\n" +
                        "This will be visible on marketplaces.\n\n" +
                        "Type your collection description:"
                    );
                    break;

                case 'awaiting_description':
                    
                    context.description = response;
                    context.status = 'complete';
                    console.log('context',context)
                    const timestamp = parseInt(studio[user].exportIntent.timestamp)
                    console.log('timestamp',timestamp)
                    // Prepare the metadata files
                    const studioDb = new StudioDB();
                    const pieces = await studioDb.findMany({
                        'export.timestamp': timestamp 
                    });
                    console.log('pieces',pieces)
                    // Create temp directory for JSONs
                    const exportDir = path.join(__dirname, '../../../../temp', `metadata_${user}`);
                    fs.mkdirSync(exportDir, { recursive: true });

                    // Generate individual JSONs for each piece
                    for (const piece of pieces) {
                            console.log('piece',piece)
                            const metadata = {
                                name: `${context.name} ${piece.export.number}`,
                                symbol: context.symbol,
                                description: context.description,
                                image: `/${piece.export.number}.png`,
                                attributes: Object.entries(piece.traits)
                                .map(([type, traitData]) => ({
                                    trait_type: type,
                                    value: traitData.value.name
                                }))
                            };

                            fs.writeFileSync(
                                path.join(exportDir, `${piece.export.number}.json`),
                                JSON.stringify(metadata, null, 2)
                            );
                        
                    }

                    // Zip and send
                    const zipPath = path.join(exportDir, 'metadata.zip');
                    const output = fs.createWriteStream(zipPath);
                    const archive = archiver('zip', { zlib: { level: 9 } });
                    
                    archive.pipe(output);
                    archive.glob('*.json', {
                        cwd: exportDir
                    });
                    await archive.finalize();

                    await sendDocument(
                        message, 
                        zipPath,
                        { caption: "✅ Here are your LaunchMyNFT metadata files!" }
                    );

                    // Cleanup
                    fs.rmSync(exportDir, { recursive: true, force: true });
                    delete studio[user].launchMyNFT;
                    break;
            }
        }

    } catch (error) {
        console.error('Error in handleSetExport:', error);
        await sendMessage(
            message,
            "❌ An error occurred. Please try again or contact support."
        );
    }
}

module.exports = new CollectionExport();