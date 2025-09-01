const { BaseDB } = require('./BaseDB');
const { ObjectId } = require('mongodb');
class CooksDB extends BaseDB {
  constructor(logger){
    super('cooks');
    this.logger = logger || console;
  }

  async createCook({ collectionId, initiatorAccountId, targetSupply, status='running', metadata={} }){
    const doc={
      collectionId,
      initiatorAccountId: new ObjectId(initiatorAccountId),
      targetSupply,
      generatedCount:0,
      status,
      metadata,
      startedAt:new Date(),
      updatedAt:new Date(),
      generationIds:[],
      costUsd:null,
    };
    const res=await this.insertOne(doc);
    return { _id: res.insertedId, ...doc };
  }

  async addGeneration(cookId, generationId){
    await this.updateOne({ _id: new ObjectId(cookId) }, { $push:{ generationIds: new ObjectId(generationId) }, $inc:{ generatedCount:1 }, $set:{ updatedAt:new Date() } });
  }
}
module.exports = CooksDB;
