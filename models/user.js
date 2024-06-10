module.exports = (sequelize, DataTypes) => {
    return sequelize.define('User', {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        fullName: {
            type: DataTypes.STRING,
            allowNull: false
        },
        username: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false
        },
        email: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false
        },
        cluster: {
            type: DataTypes.STRING,
            allowNull: false
        },
        institution: {
            type: DataTypes.STRING,
            allowNull: false
        },
        membershipNumber: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false
        },
        resetToken: {
            type: DataTypes.STRING,
            allowNull: true
        },
        resetTokenExpires: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        timestamps: true 
    });
};
