const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize('kstw_db', 'kstw_user', 'Kkk24041980#', {
    host: 'localhost',
    dialect: 'mysql'
});

console.log('Requiring User model...');
const User = require('./models/user')(sequelize, DataTypes);
console.log('User model required successfully.');

console.log('Requiring Contribution model...');
const Contribution = require('./models/contribution')(sequelize, DataTypes);
console.log('Contribution model required successfully.');

async function resetDatabase() {
    try {
        console.log('Starting to synchronize the database...');
        await sequelize.sync({ force: true });
        console.log('All tables dropped and recreated successfully.');
    } catch (error) {
        console.error('Error resetting database:', error);
    } finally {
        await sequelize.close();
        console.log('Database connection closed.');
    }
}

resetDatabase();
