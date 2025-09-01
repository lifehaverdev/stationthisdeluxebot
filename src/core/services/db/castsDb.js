const { BaseDB } = require('./BaseDB');
const { ObjectId } = require('mongodb');

class CastsDB extends BaseDB {
  constructor(logger){
    super('casts');
    this.logger = logger || console;
  }

  async createCast({ spellId, initiatorAccountId, status='running', metadata={} }){
    const doc={
      spellId: new ObjectId(spellId),
      initiatorAccountId: new ObjectId(initiatorAccountId),
      status,
      metadata,
      startedAt:new Date(),
      updatedAt:new Date(),
      stepGenerationIds:[],
      costUsd:null,
    };
    const res = await this.insertOne(doc);
    return { _id: res.insertedId, ...doc };
  }

  async addGeneration(castId, generationId){
    await this.updateOne({ _id: new ObjectId(castId) }, { $push: { stepGenerationIds: new ObjectId(generationId) }, $set:{updatedAt:new Date()} });
  }
}

module.exports = CastsDB;
