const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User')(sequelize, DataTypes);

module.exports = (sequelize, DataTypes) => {
  const Contribution = sequelize.define('Contribution', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: User,
        key: 'id',
      },
    },
    amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recipientMembershipNumber: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  }, {
    tableName: 'contributions',
    timestamps: true,
  });

  Contribution.associate = (models) => {
    Contribution.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
    Contribution.belongsTo(models.User, { as: 'recipient', foreignKey: 'recipientId' });
    models.User.hasMany(Contribution, { foreignKey: 'userId', as: 'userContributions' });
    models.User.hasMany(Contribution, { foreignKey: 'recipientId', as: 'receivedContributions' });
  };

  return Contribution;
};
