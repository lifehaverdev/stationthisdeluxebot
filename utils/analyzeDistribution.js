const fs = require('fs');
const path = require('path');

function analyzeDistribution(exportDir) {
    // Track real pieces vs placeholders
    const realPieces = [];
    const totalSlots = 4440;
    
    // Scan through all numbers
    for (let i = 1; i <= totalSlots; i++) {
        const imagePath = path.join(exportDir, `${i}.png`);
        if (fs.existsSync(imagePath)) {
            realPieces.push(i);
        }
    }

    console.log(`Scanning directory: ${exportDir}`);
    console.log(`First few real pieces found: ${realPieces.slice(0, 10).join(', ')}`);

    // Calculate metrics
    const metrics = {
        totalPieces: realPieces.length,
        totalPlaceholders: totalSlots - realPieces.length,
        
        // Distribution metrics
        averageGap: calculateAverageGap(realPieces),
        maxGap: calculateMaxGap(realPieces),
        standardDeviation: calculateStandardDeviation(realPieces),
        
        // Clustering analysis
        clusters: analyzeClusters(realPieces),
        
        // Section distribution (divide into 10 sections)
        sectionDistribution: analyzeSections(realPieces, totalSlots, 10)
    };

    return metrics;
}

function calculateAverageGap(pieces) {
    if (pieces.length < 2) return 0;
    const gaps = [];
    for (let i = 1; i < pieces.length; i++) {
        gaps.push(pieces[i] - pieces[i-1]);
    }
    return gaps.reduce((a, b) => a + b) / gaps.length;
}

function calculateMaxGap(pieces) {
    if (pieces.length < 2) return 0;
    let maxGap = 0;
    for (let i = 1; i < pieces.length; i++) {
        maxGap = Math.max(maxGap, pieces[i] - pieces[i-1]);
    }
    return maxGap;
}

function calculateStandardDeviation(pieces) {
    if (pieces.length < 2) return 0;
    const gaps = [];
    for (let i = 1; i < pieces.length; i++) {
        gaps.push(pieces[i] - pieces[i-1]);
    }
    const mean = gaps.reduce((a, b) => a + b) / gaps.length;
    const squareDiffs = gaps.map(gap => Math.pow(gap - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b) / gaps.length);
}

function analyzeClusters(pieces) {
    // Define a cluster as 3 or more pieces with gaps less than average
    const avgGap = calculateAverageGap(pieces);
    let clusters = [];
    let currentCluster = [pieces[0]];
    
    console.log(`\nDebug: Average gap is ${avgGap}`);
    
    for (let i = 1; i < pieces.length; i++) {
        const gap = pieces[i] - pieces[i-1];
        if (gap < avgGap) {
            currentCluster.push(pieces[i]);
        } else {
            if (currentCluster.length >= 3) {
                console.log(`Found cluster: ${currentCluster.length} pieces [${currentCluster[0]}...${currentCluster[currentCluster.length-1]}]`);
                clusters.push([...currentCluster]);
            }
            currentCluster = [pieces[i]];
        }
    }
    
    // Don't forget to check the last cluster
    if (currentCluster.length >= 3) {
        console.log(`Found final cluster: ${currentCluster.length} pieces [${currentCluster[0]}...${currentCluster[currentCluster.length-1]}]`);
        clusters.push([...currentCluster]);
    }
    
    // Add more detailed cluster metrics
    return {
        count: clusters.length,
        largestSize: clusters.length > 0 ? Math.max(...clusters.map(c => c.length)) : 0,
        averageSize: clusters.length > 0 ? 
            clusters.reduce((a, b) => a + b.length, 0) / clusters.length : 0,
        clusterSizes: clusters.map(c => c.length) // Add this to see distribution of cluster sizes
    };
}

function analyzeSections(pieces, totalSlots, numSections) {
    const sectionSize = totalSlots / numSections;
    const distribution = new Array(numSections).fill(0);
    
    pieces.forEach(piece => {
        const sectionIndex = Math.floor((piece - 1) / sectionSize);
        distribution[sectionIndex]++;
    });
    
    return {
        distribution,
        expectedPerSection: pieces.length / numSections,
        variance: calculateVariance(distribution)
    };
}

function calculateVariance(distribution) {
    const mean = distribution.reduce((a, b) => a + b) / distribution.length;
    return Math.sqrt(
        distribution.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / distribution.length
    );
}

// Run the analysis
const exportDir = path.join(__dirname, '../temp/export_STB OFFICIAL COLLECTION TEST');
const results = analyzeDistribution(exportDir);

console.log('\n=== Shuffle Quality Analysis ===\n');
console.log(`Total Real Pieces: ${results.totalPieces}`);
console.log(`Total Placeholders: ${results.totalPlaceholders}`);
console.log('\nDistribution Metrics:');
console.log(`Average Gap Between Pieces: ${results.averageGap.toFixed(2)}`);
console.log(`Maximum Gap: ${results.maxGap}`);
console.log(`Standard Deviation: ${results.standardDeviation.toFixed(2)}`);

console.log('\nClustering Analysis:');
console.log(`Number of Clusters: ${results.clusters.count}`);
console.log(`Largest Cluster Size: ${results.clusters.largestSize}`);
console.log(`Average Cluster Size: ${results.clusters.averageSize.toFixed(2)}`);
console.log('Cluster size distribution:', 
    results.clusters.clusterSizes
        .sort((a,b) => b-a)
        .slice(0, 10)
        .join(', ') + 
    (results.clusters.clusterSizes.length > 10 ? '...' : '')
);

console.log('\nSection Distribution:');
console.log('Expected pieces per section:', results.sectionDistribution.expectedPerSection.toFixed(2));
console.log('Actual distribution:', results.sectionDistribution.distribution);
console.log('Distribution variance:', results.sectionDistribution.variance.toFixed(2));

// A perfect shuffle would have:
// 1. Even distribution across sections (low variance)
// 2. Few or no large clusters
// 3. Standard deviation close to the theoretical ideal
// 4. Average gap close to theoretical ideal (totalSlots / totalPieces)

/*
=== Shuffle Quality Analysis ===

Total Real Pieces: 3515
Total Placeholders: 925

Distribution Metrics:
Average Gap Between Pieces: 1.26
Maximum Gap: 11
Standard Deviation: 0.70

Clustering Analysis:
Number of Clusters: 307
Largest Cluster Size: 1009
Average Cluster Size: 10.07
Cluster size distribution: 1009, 50, 45, 39, 36, 35, 30, 29, 24, 24...

Section Distribution:
Expected pieces per section: 351.50
Actual distribution: [
  444, 444, 345, 325,
  343, 309, 341, 344,
  287, 333
]
Distribution variance: 49.40
*/