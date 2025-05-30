const { BaseDB, ObjectId } = require('./BaseDB');

/**
 * @class LoRATrainingsDB
 *
 * This class manages LoRA training sessions, which are user-submitted datasets used to train one or more LoRA models.
 * Each session can produce multiple outputs (e.g., Flux light, SDXL full), and contain multiple caption variants.
 *
 * New additions support:
 * - Future marketplace integration (via `collectionId`, `ownedBy`)
 * - Provenance tracking (authorship vs. ownership)
 * - Publishing eligibility (`allowPublishing`)
 *
 * {
 *   _id: ObjectId,
 *   name: string,
 *   userId: ObjectId,
 *   ownedBy?: ObjectId,               // Defaults to userId unless sold/transferred
 *   collectionId?: ObjectId,          // Optional FK to model collection
 *   images: [ObjectId],
 *   captionSets: [
 *     {
 *       _id: string,
 *       name: string,
 *       captions: [string],
 *       createdAt: Date
 *     }
 *   ],
 *   trainingRuns: [
 *     {
 *       _id: string,
 *       tool: string,
 *       modelType: string,
 *       checkpoint: string,
 *       steps: number,
 *       captionSetId: string,
 *       outputLoRAId?: ObjectId,
 *       status: "queued" | "complete" | "failed",
 *       trainedAt: Date
 *     }
 *   ],
 *   status: "draft" | "submitted" | "training" | "complete" | "failed",
 *   preferredTrigger: string,
 *   tags: [string],
 *   allowPublishing: boolean,
 *   notes?: string,
 *   createdAt: Date,
 *   updatedAt?: Date,
 *   submittedAt?: Date,
 *   completedAt?: Date
 * }
 */

class LoRATrainingsDB extends BaseDB {
  constructor(logger) {
    super('loraTrainings');
    this.logger = logger || console;
  }

  async createTrainingSession(trainingData) {
    const now = new Date();
    const dataToInsert = {
      createdAt: now,
      updatedAt: now,
      status: 'draft',
      captionSets: [],
      trainingRuns: [],
      ownedBy: trainingData.userId, // Defaults ownership to creator
      ...trainingData,
    };
    const result = await this.insertOne(dataToInsert);
    return result.insertedId ? { _id: result.insertedId, ...dataToInsert } : null;
  }

  async findTrainingById(trainingId) {
    return this.findOne({ _id: new ObjectId(trainingId) });
  }

  async addCaptionSet(trainingId, captionSet) {
    return this.updateOne(
      { _id: new ObjectId(trainingId) },
      {
        $push: { captionSets: captionSet },
        $set: { updatedAt: new Date() }
      }
    );
  }

  async addTrainingRun(trainingId, trainingRun) {
    return this.updateOne(
      { _id: new ObjectId(trainingId) },
      {
        $push: { trainingRuns: trainingRun },
        $set: { updatedAt: new Date() }
      }
    );
  }

  async updateTrainingStatus(trainingId, status) {
    return this.updateOne(
      { _id: new ObjectId(trainingId) },
      {
        $set: { status, updatedAt: new Date() }
      }
    );
  }

  async attachLoRAOutput(trainingId, runId, loraId) {
    return this.updateOne(
      { _id: new ObjectId(trainingId), 'trainingRuns._id': runId },
      {
        $set: {
          'trainingRuns.$.outputLoRAId': new ObjectId(loraId),
          updatedAt: new Date()
        }
      }
    );
  }

  async findTrainingsByUser(userId, options = {}) {
    return this.findMany({ userId: new ObjectId(userId) }, options);
  }

  async transferOwnership(trainingId, newOwnerId) {
    return this.updateOne(
      { _id: new ObjectId(trainingId) },
      {
        $set: {
          ownedBy: new ObjectId(newOwnerId),
          updatedAt: new Date()
        }
      }
    );
  }

  async assignToCollection(trainingId, collectionId) {
    return this.updateOne(
      { _id: new ObjectId(trainingId) },
      {
        $set: {
          collectionId: new ObjectId(collectionId),
          updatedAt: new Date()
        }
      }
    );
  }
}

module.exports = LoRATrainingsDB;
