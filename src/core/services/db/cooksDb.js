const { BaseDB } = require('./BaseDB');
const { ObjectId } = require('mongodb');
class CooksDB extends BaseDB {
  constructor(logger){
    super('cooks');
    this.logger = logger || console;
  }

  async createCook({ collectionId, initiatorAccountId, targetSupply, status='running', metadata={} }){
    // ✅ VALIDATION: Verify ObjectId format before conversion
    if (!ObjectId.isValid(initiatorAccountId)) {
      throw new Error(`Invalid initiatorAccountId format: ${initiatorAccountId}`);
    }
    
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
      events:[], // ✅ Initialize events array for tracking cook events
    };
    const res=await this.insertOne(doc);
    return { _id: res.insertedId, ...doc };
  }

  async addGeneration(cookId, generationId){
    // ✅ VALIDATION: Verify ObjectId formats before conversion
    if (!ObjectId.isValid(cookId)) {
      throw new Error(`Invalid cookId format: ${cookId}`);
    }
    if (!ObjectId.isValid(generationId)) {
      throw new Error(`Invalid generationId format: ${generationId}`);
    }
    
    await this.updateOne({ _id: new ObjectId(cookId) }, { $push:{ generationIds: new ObjectId(generationId) }, $inc:{ generatedCount:1 }, $set:{ updatedAt:new Date() } });
  }
}
module.exports = CooksDB;
