require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const nodemailer = require('nodemailer');
const argon2 = require('argon2'); // Replace bcrypt with argon2
const crypto = require('crypto');
const fastcsv = require('fast-csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // Enable CORS
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  dialect: 'mysql',
  logging: false
});

const User = sequelize.define('User', {
  fullName: { type: DataTypes.STRING, allowNull: false },
  username: { type: DataTypes.STRING, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  membershipNumber: { type: DataTypes.STRING, allowNull: false },
  resetToken: { type: DataTypes.STRING },
  resetTokenExpires: { type: DataTypes.DATE }
}, { timestamps: true });

const Contribution = sequelize.define('Contribution', {
  amount: { type: DataTypes.FLOAT, allowNull: false },
  description: { type: DataTypes.STRING },
  recipientMembershipNumber: { type: DataTypes.STRING, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: true }
}, { timestamps: true });

User.hasMany(Contribution, { foreignKey: 'userId' });
Contribution.belongsTo(User, { foreignKey: 'userId' });

sequelize.sync({ alter: true }).then(() => {
  console.log('Database synchronized');
}).catch(err => {
  console.error('Unable to synchronize the database:', err);
});

async function generateMembershipNumber() {
  const prefix = 'KSTW';
  const lastUser = await User.findOne({ order: [['id', 'DESC']] });
  const lastNumber = lastUser ? parseInt(lastUser.membershipNumber.split('-')[1], 10) : 0;
  const nextNumber = (lastNumber + 1).toString().padStart(4, '0');
  const yearSuffix = new Date().getFullYear().toString().slice(-2);
  return `${prefix}-${nextNumber}-${yearSuffix}`;
}

async function sendResetEmail(email, token, port) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset',
      text: `Click the link to reset your password: http://localhost:${port}/reset-password?token=${token}`,
    };

    console.log("mailOptions:", mailOptions);

    await transporter.sendMail(mailOptions);
    console.log("Password reset email sent successfully to:", email);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false; 
  }
}

app.post('/register', async (req, res) => {
  try {
    const { fullName, username, password, email } = req.body;
    if (!fullName || !username || !password || !email) {
      console.log('Missing required fields:', req.body);
      return res.status(400).json({ message: 'All fields are required' });
    }
    const hashedPassword = await argon2.hash(password); // Use argon2 for hashing
    const membershipNumber = await generateMembershipNumber();
    const newUser = await User.create({ fullName, username, password: hashedPassword, email, membershipNumber });
    res.status(201).json({ message: 'Registration successful', membershipNumber });
  } catch (error) {
    console.error('Registration failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password, membershipNumber } = req.body;
    if ((!username && !membershipNumber) || !password) {
      return res.status(400).json({ message: 'Username/Membership Number and password are required' });
    }
    const user = await User.findOne({ where: username ? { username } : { membershipNumber } });
    if (user && await argon2.verify(user.password, password)) { // Use argon2 for verifying password
      res.status(200).json({ message: 'Login successful', redirectUrl: '/contribution' });
    } else {
      res.status(401).json({ message: 'Invalid username/membership number or password' });
    }
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.post('/contribution', async (req, res) => {
  try {
    const { amount, description, membershipNumber, recipientMembershipNumber } = req.body;

    console.log('Received data:', { amount, description, membershipNumber, recipientMembershipNumber });

    if (!amount || !membershipNumber || !recipientMembershipNumber) {
      return res.status(400).json({ message: 'Amount, membership number, and recipient membership number are required' });
    }

    const user = await User.findOne({ where: { membershipNumber } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const contribution = await Contribution.create({
      amount,
      description,
      userId: user.id,
      recipientMembershipNumber
    });

    res.status(201).json({ message: 'Contribution successful', contribution });
  } catch (error) {
    console.error('Contribution failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(20).toString('hex');
      const tokenExpires = new Date(Date.now() + 3600000);
      await user.update({ resetToken: token, resetTokenExpires: tokenExpires });
      const emailSent = await sendResetEmail(email, token, port);
      if (emailSent) {
        console.log('Password reset email sent to:', email);
        res.status(200).json({ message: 'Password reset email sent' });
      } else {
        console.log('Password reset email sending failed for:', email);
        res.status(500).json({ message: 'Failed to send password reset email' });
      }
    } else {
      console.log('User not found for email:', email);
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error('Password reset request failed:', error);
    res.status(500).json({ message: 'Internal server    error', error: error.message });
  }
});

app.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const user = await User.findOne({
      where: {
        resetToken: token,
        resetTokenExpires: { [Sequelize.Op.gt]: new Date() }
      }
    });
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
    const hashedPassword = await argon2.hash(newPassword); // Use argon2 for hashing
    await user.update({ password: hashedPassword, resetToken: null, resetTokenExpires: null });
    res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Password reset failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Additional endpoints for downloading contributions in different formats
app.get('/contributions/csv', async (req, res) => {
  try {
    const contributions = await Contribution.findAll();
    const csvStream = fastcsv.format({ headers: true });
    res.setHeader('Content-Disposition', 'attachment; filename=contributions.csv');
    res.setHeader('Content-Type', 'text/csv');
    csvStream.pipe(res);
    contributions.forEach(contribution => {
      csvStream.write(contribution.toJSON());
    });
    csvStream.end();
  } catch (error) {
    console.error('CSV download failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/contributions/excel', async (req, res) => {
  try {
    const contributions = await Contribution.findAll();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Contributions');
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Amount', key: 'amount', width: 10 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Recipient Membership Number', key: 'recipientMembershipNumber', width: 20 },
      { header: 'User ID', key: 'userId', width: 10 },
      { header: 'Created At', key: 'createdAt', width: 20 },
      { header: 'Updated At', key: 'updatedAt', width: 20 }
    ];
    contributions.forEach(contribution => {
      worksheet.addRow(contribution.toJSON());
    });
    res.setHeader('Content-Disposition', 'attachment; filename=contributions.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel download failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/contributions/pdf', async (req, res) => {
  try {
    const contributions = await Contribution.findAll();
    const doc = new PDFDocument();
    res.setHeader('Content-Disposition', 'attachment; filename=contributions.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(12).text('Contributions', { align: 'center' });
    doc.moveDown();
    contributions.forEach(contribution => {
      doc.text(`ID: ${contribution.id}`);
      doc.text(`Amount: ${contribution.amount}`);
      doc.text(`Description: ${contribution.description}`);
      doc.text(`Recipient Membership Number: ${contribution.recipientMembershipNumber}`);
      doc.text(`User ID: ${contribution.userId}`);
      doc.text(`Created At: ${contribution.createdAt}`);
      doc.text(`Updated At: ${contribution.updatedAt}`);
      doc.moveDown();
    });
    doc.end();
  } catch (error) {
    console.error('PDF download failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

// Test endpoint to verify database connection
app.get('/test-db', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({ message: 'Database connection successful' });
  } catch (error) {
    console.error('Database connection failed:', error);
    res.status(500).json({ message: 'Database connection failed', error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

