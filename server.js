require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fastcsv = require('fast-csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

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


const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
      return res.status(400).json({ message: 'All fields are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
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
    if (user && await bcrypt.compare(password, user.password)) {
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
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    const user = await User.findOne({ where: { resetToken: token, resetTokenExpires: { [Sequelize.Op.gt]: new Date() } } });
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await user.update({ password: hashedPassword, resetToken: null, resetTokenExpires: null });
    res.status(200).json({ message: 'Password reset successful', redirectUrl: '/login' });
  } catch (error) {
    console.error('Password reset failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/check-username', async (req, res) => {
  try {
    const { username } = req.query;
    const user = await User.findOne({ where: { username } });
    res.status(user ? 400 : 200).json({ message: user ? 'Username is already taken' : 'Username is available' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/user/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (user) {
      res.status(200).json(user);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/export/csv', async (req, res) => {
  try {
    const users = await User.findAll();
    const csvStream = fastcsv.format({ headers: true });
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.setHeader('Content-Type', 'text/csv');
    csvStream.pipe(res);
    users.forEach(user => csvStream.write(user.get({ plain: true })));
    csvStream.end();
  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/export/excel', async (req, res) => {
  try {
    const users = await User.findAll({
      include: [{ model: Contribution }]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Users with Contributions');
    
    worksheet.columns = [
      { header: 'Full Name', key: 'fullName', width: 20 },
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Membership Number', key: 'membershipNumber', width: 30 },
      { header: 'Created At', key: 'createdAt', width: 20 },
      { header: 'Updated At', key: 'updatedAt', width: 20 },
      { header: 'Contribution Amount', key: 'contributionAmount', width: 20 },
      { header: 'Contribution Description', key: 'contributionDescription', width: 30 },
      { header: 'Contribution Date', key: 'contributionDate', width: 20 },
      { header: 'Recipient Membership Number', key: 'recipientMembershipNumber', width: 30 }
    ];

    users.forEach(user => {
      const userData = {
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        membershipNumber: user.membershipNumber,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      };

      if (user.Contributions.length > 0) {
        user.Contributions.forEach(contribution => {
          worksheet.addRow({
            ...userData,
            contributionAmount: contribution.amount,
            contributionDescription: contribution.description,
            contributionDate: contribution.createdAt,
            recipientMembershipNumber: contribution.recipientMembershipNumber
          });
        });
      } else {
        worksheet.addRow(userData);
      }
    });

    res.setHeader('Content-Disposition', 'attachment; filename="users_with_contributions.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting Excel:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});


app.get('/export/pdf', async (req, res) => {
  try {
    const users = await User.findAll({
      include: [{ model: Contribution }]
    });

    const doc = new PDFDocument();
    res.setHeader('Content-Disposition', 'attachment; filename="users_with_contributions.pdf"');
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);

    doc.fontSize(20).text('Users List with Contributions', { align: 'center' });
    doc.moveDown();

    users.forEach(user => {
      const userData = `
        Full Name: ${user.fullName}
        Username: ${user.username}
        Email: ${user.email}
        Membership Number: ${user.membershipNumber}
        Created At: ${user.createdAt}
        Updated At: ${user.updatedAt}
      `;
      doc.fontSize(12).text(userData, { align: 'left' });
      doc.moveDown();

      if (user.Contributions.length > 0) {
        user.Contributions.forEach(contribution => {
          const contributionData = `
            Contribution Amount: ${contribution.amount}
            Description: ${contribution.description}
            Date: ${contribution.createdAt}
            Recipient Membership Number: ${contribution.recipientMembershipNumber}
          `;
          doc.fontSize(10).text(contributionData, { align: 'left' });
          doc.moveDown();
        });
      }
    });

    doc.end();
  } catch (error) {
    console.error('Error exporting PDF:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/test-db', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({ message: 'Database connection successful' });
  } catch (error) {
    res.status(500).json({ message: 'Database connection failed', error: error.message });
  }
});

app.get('/create-test-user', async (req, res) => {
  try {
    const testUser = await User.create({
      fullName: 'Test User',
      username: 'testuser',
      password: await bcrypt.hash('password', 10),
      email: 'testuser@example.com',
      membershipNumber: await generateMembershipNumber()
    });
    res.status(201).json({ message: 'Test user created', user: testUser });
  } catch (error) {
    res.status(500).json({ message: 'Error creating test user', error: error.message });
  }
});


app.get('/users-contributions', async (req, res) => {
  try {
    const users = await User.findAll({
      include: [{ model: Contribution }]
    });
    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching users with contributions:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.use(express.static('public'));

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/contribution', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contribution.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

