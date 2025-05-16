const fs = require('fs');
const readline = require('readline');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Helper function to parse CSV line while respecting quotes
function parseCSVLine(line) {
  const values = [];
  let currentValue = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      values.push(currentValue.trim());
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  values.push(currentValue.trim());

  // Clean up quotes from values
  return values.map(val => val.replace(/^"(.*)"$/, '$1'));
}

async function enrichLoras() {
  // Read existing CSV
  const input = fs.readFileSync('./db/data/lora_triggers_2024-12-24T02-20-40-369Z.csv', 'utf8');
  const [header, ...lines] = input.trim().split('\n');
  
  // Define the expected column order
  const columnOrder = [
    'lora_name',
    'default_weight',
    'version',
    'type',
    'gate',
    'civitaiLink',
    'description',
    'triggerWords',
    'uses'
  ];

  // Parse CSV lines into objects using the known column order
  const records = lines.map(line => {
    const values = parseCSVLine(line);
    return columnOrder.reduce((obj, column, index) => {
      obj[column] = values[index] || '';
      return obj;
    }, {});
  });

  const enrichedRecords = [];
  
  for (const lora of records) {
    console.log('\n========================================');
    console.log(`Processing LoRA: ${lora.lora_name}`);
    console.log(`Current trigger words: ${lora.triggerWords}`);
    console.log(`Type: ${lora.type}`);
    console.log('========================================\n');

    const enrichedLora = {
      ...lora,
      tags: {
        [lora.type]: true
      },
      cognates: [],
      exampleImagePath: path.join('loraExamples', `${lora.lora_name}.png`)
    };

    // Ask for cognates
    let addingCognates = true;
    while (addingCognates) {
      const addCognate = await question('Would you like to add a cognate? (y/n): ');
      if (addCognate.toLowerCase() !== 'y') {
        addingCognates = false;
        continue;
      }

      const cognateWord = await question('Enter cognate word: ');
      const shouldReplace = await question('Should this cognate replace the original word? (y/n): ');
      const replaceWith = shouldReplace.toLowerCase() === 'y' ? 
        await question('Enter replacement word: ') : 
        '';

      enrichedLora.cognates.push({
        word: cognateWord,
        replaceWith: replaceWith || null
      });
    }

    // Ask for additional tags
    let addingTags = true;
    while (addingTags) {
      const addTag = await question('Would you like to add an additional tag? (y/n): ');
      if (addTag.toLowerCase() !== 'y') {
        addingTags = false;
        continue;
      }

      const tag = await question('Enter tag: ');
      enrichedLora.tags[tag] = true;
    }

    // Convert tags and cognates to strings for CSV storage
    enrichedLora.tagsJson = JSON.stringify(enrichedLora.tags);
    enrichedLora.cognatesJson = JSON.stringify(enrichedLora.cognates);
    delete enrichedLora.tags;
    delete enrichedLora.cognates;

    enrichedRecords.push(enrichedLora);
    
    // Save progress after each LoRA
    const newHeaders = Object.keys(enrichedRecords[0]);
    const csvContent = [
      newHeaders.join(','),
      ...enrichedRecords.map(record => 
        newHeaders.map(header => 
          JSON.stringify(record[header] || '')
        ).join(',')
      )
    ].join('\n');
    
    fs.writeFileSync('./db/data/enriched_loras.csv', csvContent);
    
    console.log(`Processed ${enrichedRecords.length}/${records.length} LoRAs`);
  }

  rl.close();
  
  console.log('\nEnrichment complete! New CSV created at ./db/data/enriched_loras.csv');
}

enrichLoras().catch(console.error);