const { BaseDB } = require('./BaseDB');

class FloorplanDB extends BaseDB {
    constructor() {
        super('floorplan');
    }

    async createRoom(groupId, roomData) {
        return this.updateOne(
            { id: groupId },
            roomData,
            { upsert: true }
        );
    }

    async writeRoomData(groupId, data) {
        return this.updateOne(
            { id: groupId },
            data
        );
    }
    
    async saveGroupSettings(groupId, settings) {
        return this.updateOne(
            { id: groupId },
            { settings }
        );
    }

    async writeGroupQoints(groupId, qoints) {
        return this.updateOne(
            { id: groupId },
            { qoints }
        );
    }

    async getAllFloors() {
        return this.findMany();
    }
}

module.exports = FloorplanDB;