const StudioDB = require('../models/studio');
const { CollectionDB } = require('../index');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

async function exportCollection(collectionId, totalSupply, outputPath = null) {
    try {
        // Initialize metrics
        const metrics = {
            startTime: performance.now(),
            totalBytes: 0,
            pieces: 0
        };

        // Get collection info
        const collectionDb = new CollectionDB();
        const collection = await collectionDb.findOne({ collectionId });
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        // Create output directory
        const exportDir = outputPath || path.join(__dirname, '../../temp', `export_${collection.name}`);
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        // Get approved pieces
        const studioDb = new StudioDB();
        const pieces = await studioDb.findMany({
            collectionId,
            status: { $in: ['approved'] },
            isIn: { $ne: true } // Only get pieces that aren't already in the collection
        });

        // Create array of all possible numbers 1 to totalSupply
        const allNumbers = Array.from({ length: totalSupply }, (_, i) => i + 1);
        
        // Shuffle ALL numbers first
        const shuffledNumbers = allNumbers.sort(() => Math.random() - 0.5);

        // This will hold our piece-to-number assignments
        const assignments = new Map();
        
        // Assign pieces to the first N shuffled numbers
        pieces.forEach((piece, index) => {
            if (index < shuffledNumbers.length) {
                assignments.set(shuffledNumbers[index], piece);
            }
        });

        // Now process in numerical order, using assignments map
        for (let number = 1; number <= totalSupply; number++) {
            const piece = assignments.get(number);
            
            if (piece) {
                // This is a real piece - mark it and export it
                await studioDb.updateOne(
                    { _id: piece._id },
                    { 
                        isIn: true,
                        assignedNumber: number 
                    }
                );

                // Download image
                const imageUrl = piece.files[0]?.url;
                if (imageUrl) {
                    try {
                        const response = await axios({
                            url: imageUrl,
                            responseType: 'stream'
                        });

                        // Save image
                        const imagePath = path.join(exportDir, `${number}.png`);
                        const writer = fs.createWriteStream(imagePath);
                        response.data.pipe(writer);

                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });

                        // Create and save metadata
                        const metadata = {
                            name: `CULT INCORPORATED BADGE ${number}`,
                            description: collection.description || `You are now an Executive of the Cult.
Backed by 1,000,000 $EXEC and subject to burn if unaligned.
This badge confirms your standing, your timing, and your loyalty.
Transfer with care. Hold with conviction. You were chosen.`,
                            image: `${number}.png`,
                            attributes: [
                                ...piece.traits.map(trait => ({
                                    trait_type: trait.type,
                                    value: trait.value.name
                                })),
                                {
                                    trait_type: "prompt",
                                    value: piece.prompt
                                }
                            ]
                        };

                        fs.writeFileSync(
                            path.join(exportDir, `${number}.json`),
                            JSON.stringify(metadata, null, 2)
                        );

                        metrics.pieces++;
                        console.log(`Exported piece ${number}/${totalSupply}`);

                    } catch (error) {
                        console.error(`Error exporting piece ${number}:`, error);
                    }
                }
            } else {
                // This is a placeholder slot
                const metadata = {
                    name: `${collection.name} #${number}`,
                    description: collection.description || "",
                    image: `https://ms2.fun/public/unrevealed.png`,
                    attributes: [],
                    isPlaceholder: true
                };

                fs.writeFileSync(
                    path.join(exportDir, `${number}.json`),
                    JSON.stringify(metadata, null, 2)
                );
            }
        }

        console.log(`Export complete! ${metrics.pieces} pieces exported to ${exportDir}`);
        return {
            success: true,
            exportPath: exportDir,
            piecesExported: metrics.pieces
        };

    } catch (error) {
        console.error('Export failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Allow direct script execution
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node exportCollection.js <collectionId> <totalSupply> [outputPath]');
        process.exit(1);
    }

    const [collectionId, totalSupply, outputPath] = args;
    exportCollection(parseInt(collectionId), parseInt(totalSupply), outputPath)
        .then(result => {
            console.log(result);
            process.exit(result.success ? 0 : 1);
        });
}

module.exports = exportCollection;