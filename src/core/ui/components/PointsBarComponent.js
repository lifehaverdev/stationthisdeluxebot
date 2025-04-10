/**
 * PointsBarComponent
 * 
 * A specialized component for displaying user points balance
 * with a visual representation using emoji or other visualizations.
 */

const UIComponent = require('../interfaces/UIComponent');

/**
 * @class PointsBarComponent
 * @extends UIComponent
 * @description Component for displaying points balance with visual bar
 */
class PointsBarComponent extends UIComponent {
  /**
   * Creates a new points bar component
   * @param {Object} props - Component properties
   * @param {number} props.totalPoints - Total possible points
   * @param {number} props.spentPoints - Points spent by user
   * @param {number} props.qoints - Special/bonus points (qoints)
   * @param {number} [props.segments=7] - Number of segments in the bar
   * @param {string} [props.format='emoji'] - Format type ('emoji', 'text', 'ascii')
   * @param {boolean} [props.showValues=true] - Whether to show numeric values
   * @param {Object} [props.style={}] - Styling properties
   */
  constructor(props = {}) {
    super(props);
    this.type = 'pointsBar';
    
    // Set defaults if not provided
    this.props.totalPoints = props.totalPoints || 0;
    this.props.spentPoints = props.spentPoints || 0;
    this.props.qoints = props.qoints || 0;
    this.props.segments = props.segments || 7;
    this.props.format = props.format || 'emoji';
    this.props.showValues = props.showValues !== undefined ? props.showValues : true;
    this.props.style = props.style || {};
  }

  /**
   * Validate the component properties
   * @returns {boolean} True if valid, false otherwise
   */
  validate() {
    // All values must be numbers
    if (
      typeof this.props.totalPoints !== 'number' ||
      typeof this.props.spentPoints !== 'number' ||
      typeof this.props.qoints !== 'number' ||
      typeof this.props.segments !== 'number'
    ) {
      return false;
    }
    
    // Format must be one of the supported formats
    const validFormats = ['emoji', 'text', 'ascii'];
    if (!validFormats.includes(this.props.format)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Set the points values
   * @param {number} totalPoints - Total possible points
   * @param {number} spentPoints - Points spent by user
   * @param {number} qoints - Special/bonus points (qoints)
   * @returns {PointsBarComponent} This component
   */
  setPoints(totalPoints, spentPoints, qoints) {
    this.props.totalPoints = totalPoints;
    this.props.spentPoints = spentPoints;
    this.props.qoints = qoints;
    return this;
  }
  
  /**
   * Generate the points bar visualization
   * @returns {string} Visual representation of the points
   */
  generateBar() {
    const { totalPoints, spentPoints, qoints, segments, format } = this.props;
    
    if (format === 'emoji') {
      // Use the emoji format
      return this._generateEmojiBar(totalPoints, spentPoints, qoints, segments);
    } else if (format === 'ascii') {
      // Use ASCII format for text-only interfaces
      return this._generateAsciiBar(totalPoints, spentPoints, qoints, segments);
    } else {
      // Default to text format
      return this._generateTextBar(totalPoints, spentPoints, qoints, segments);
    }
  }
  
  /**
   * Generate emoji bar representation
   * @private
   */
  _generateEmojiBar(totalPoints, spentPoints, qoints, segments) {
    let bar = [];

    const regeneratingEmojiTiers = [
      { emoji: '💎', value: 10000 },
      { emoji: '💠', value: 1000 },
      { emoji: '🔷', value: 100 },
      { emoji: '🔹', value: 10 }
    ];

    const qointEmojiTiers = [
      { emoji: '☀️', value: 10000 },
      { emoji: '🧀', value: 1000 },
      { emoji: '🔶', value: 100 },
      { emoji: '🔸', value: 10 }
    ];

    // Helper function to fill segments based on points and tiers
    const fillSegments = (points, tiers, remainingSegments) => {
      const emojiBar = [];
      let segmentCount = remainingSegments;

      for (const tier of tiers) {
        while (points >= tier.value && segmentCount > 0) {
          emojiBar.push(tier.emoji);
          points -= tier.value;
          segmentCount--;
        }
      }

      while (segmentCount > 0) {
        if (points > 0) {
          emojiBar.push('🔹');
          points -= 10;
        } else {
          emojiBar.push('▫️');
        }
        segmentCount--;
      }

      return emojiBar;
    };

    if (qoints && qoints > 0 && totalPoints > 0) {
      bar = bar.concat(fillSegments(qoints, qointEmojiTiers, 1));
      const regenPoints = totalPoints - spentPoints;
      bar = bar.concat(fillSegments(regenPoints, regeneratingEmojiTiers, segments - 1));
      if (spentPoints > 0) {
        bar[bar.length - 1] = '▫️';
      }
    } else if (!qoints || qoints <= 0) {
      const regenPoints = totalPoints - spentPoints;
      bar = fillSegments(regenPoints, regeneratingEmojiTiers, segments);
      if (spentPoints > 0) {
        bar[bar.length - 1] = '▫️';
      }
    } else if (totalPoints <= spentPoints && qoints && qoints > 0) {
      bar = fillSegments(qoints, qointEmojiTiers, segments);
      const lowestQointValue = qointEmojiTiers[qointEmojiTiers.length - 1].value;
      if (qoints < lowestQointValue * segments) {
        bar[bar.length - 1] = '▫️';
      }
    }

    while (bar.length > segments) {
      bar.pop();
    }

    return bar.join('');
  }
  
  /**
   * Generate ASCII bar representation
   * @private
   */
  _generateAsciiBar(totalPoints, spentPoints, qoints, segments) {
    const availablePoints = Math.max(0, totalPoints - spentPoints);
    const totalSegments = segments;
    
    // Calculate how many segments each type gets
    const qointSegments = qoints > 0 
      ? Math.ceil((qoints / (qoints + availablePoints)) * totalSegments)
      : 0;
    
    const availableSegments = totalSegments - qointSegments;
    const usedSegments = availablePoints > 0 
      ? Math.ceil((availablePoints / totalPoints) * availableSegments)
      : 0;
    
    const emptySegments = totalSegments - qointSegments - usedSegments;
    
    // Build ASCII bar
    let bar = '';
    bar += '[' + '*'.repeat(qointSegments);
    bar += '#'.repeat(usedSegments);
    bar += '-'.repeat(emptySegments) + ']';
    
    return bar;
  }
  
  /**
   * Generate text bar representation
   * @private
   */
  _generateTextBar(totalPoints, spentPoints, qoints, segments) {
    const availablePoints = Math.max(0, totalPoints - spentPoints);
    const percentage = totalPoints > 0 ? Math.floor((availablePoints / totalPoints) * 100) : 0;
    const qointPercentage = qoints > 0 ? `+${qoints}` : '';
    
    return `${availablePoints}/${totalPoints} (${percentage}%)${qointPercentage}`;
  }
  
  /**
   * Get formatted text representation
   * @returns {string} Formatted text representation
   */
  getTextRepresentation() {
    const { totalPoints, spentPoints, qoints, showValues } = this.props;
    const bar = this.generateBar();
    
    if (showValues) {
      const availablePoints = Math.max(0, totalPoints - spentPoints);
      return `${bar} ${availablePoints}/${totalPoints} ${qoints > 0 ? `(+${qoints} qoints)` : ''}`;
    }
    
    return bar;
  }
}

module.exports = PointsBarComponent; 