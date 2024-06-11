const express = require('express');
require('dotenv').config();
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fastcsv = require('fast-csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  dialect: 'mysql'
});

sequelize.authenticate()
  .then(() => {
    console.log('Connection has been established successfully.');
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
  });

const User = sequelize.define('User', {
  fullName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  cluster: {
    type: DataTypes.STRING
  },
  institution: {
    type: DataTypes.STRING
  },
  membershipNumber: {
    type: DataTypes.STRING,
    defaultValue: '',
    unique: true
  },
  resetToken: {
    type: DataTypes.STRING
  },
  resetTokenExpires: {
    type: DataTypes.DATE
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  },
  updatedAt: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  }
}, {
  tableName: 'users',
  timestamps: false
});

sequelize.sync({ alter: true })
  .then(() => {
    console.log('Database & tables created!');
  })
  .catch(err => {
    console.error('Unable to update the database:', err);
  });

function generateMembershipNumber() {
  const prefix = 'kstw';
  const yearSuffix = new Date().getFullYear().toString().slice(-2);
  const randomNumber = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${randomNumber}${yearSuffix}`;
}

app.post('/register', async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const membershipNumber = generateMembershipNumber();
    const newUser = await User.create({ ...req.body, password: hashedPassword, membershipNumber });
    res.status(201).json({ message: 'Registration successful', redirectUrl: '/login' });
  } catch (error) {
    console.error('Registration failed:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      const errors = error.errors.map(err => ({
        message: err.message,
        field: err.path
      }));
      res.status(400).json({ message: 'Unique constraint error', errors });
    } else if (error.name === 'SequelizeValidationError') {
      res.status(400).json({ message: 'Validation error', errors: error.errors });
    } else {
      res.status(500).json({ message: 'Registration failed', error: error.message });
    }
  }
});

app.post('/login', async (req, res) => {
  const { username, password, membershipNumber } = req.body;
  console.log('Login request body:', req.body);

  try {
    if ((!username && !membershipNumber) || !password) {
      return res.status(400).json({ message: 'Username/Membership Number and password are required' });
    }

    const user = await User.findOne({ where: username ? { username } : { membershipNumber } });
    if (user) {
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        res.status(200).json({ message: 'Login successful', redirectUrl: '/members' });
      } else {
        res.status(401).json({ message: 'Invalid username/membership number or password' });
      }
    } else {
      res.status(401).json({ message: 'Invalid username/membership number or password' });
    }
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.use(express.static('public'));

app.get('/register', (req, res) => {
  res.sendFile(__dirname + '/public/register.html');
});

app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/public/login.html');
});

app.get('/contribution', (req, res) => {
  res.sendFile(path.join(__dirname, '/public/contribution.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '/public/dashboard.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(__dirname + '/public/forgot-password.html');
});

async function sendResetEmail(email, token) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.mail.yahoo.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Password Reset',
    text: `Click the link to reset your password: http://localhost:${port}/reset-password?token=${token}`,
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
  } catch (error) {
    console.error('Error sending email:', error);
  }
}

app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(20).toString('hex');
      const tokenExpires = new Date(Date.now() + 3600000);

      await user.update({
        resetToken: token,
        resetTokenExpires: tokenExpires,
      });

      await sendResetEmail(email, token);
      res.status(200).json({ message: 'Password reset email sent' });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error('Password reset request failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/export/csv', async (req, res) => {
  const users = await User.findAll();

  const csvStream = fastcsv.format({ headers: true });
  res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
  res.setHeader('Content-Type', 'text/csv');

  csvStream.pipe(res);

  users.forEach(user => {
    csvStream.write(user.get({ plain: true }));
  });

  csvStream.end();
});

app.get('/export/excel', async (req, res) => {
  const users = await User.findAll();

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Users');

  worksheet.columns = [
    { header: 'Full Name', key: 'fullName', width: 20 },
    { header: 'Username', key: 'username', width: 20 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Cluster', key: 'cluster', width: 20 },
    { header: 'Institution', key: 'institution', width: 20 },
    { header: 'Membership Number', key: 'membershipNumber', width: 30 },
    { header: 'Created At', key: 'createdAt', width: 20 },
    { header: 'Updated At', key: 'updatedAt', width: 20 }
  ];

  users.forEach(user => {
    worksheet.addRow(user.get({ plain: true }));
  });

  res.setHeader('Content-Disposition', 'attachment; filename="users.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  await workbook.xlsx.write(res);
  res.end();
});

app.get('/export/pdf', async (req, res) => {
  try {
    const users = await User.findAll();

    const doc = new PDFDocument();
    res.setHeader('Content-Disposition', 'attachment; filename="users.pdf"');
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);

    doc.fontSize(20).text('Users List', { align: 'center' });
    doc.moveDown();

    users.forEach(user => {
      const userData = `
        Full Name: ${user.fullName}
        Username: ${user.username}
        Email: ${user.email}
        Cluster: ${user.cluster}
                Institution: ${user.institution}
        Membership Number: ${user.membershipNumber}
        Created At: ${user.createdAt}
        Updated At: ${user.updatedAt}
      `;
      doc.fontSize(12).text(userData, { align: 'left' });
      doc.moveDown();
    });

    doc.end();
  } catch (error) {
    console.error('Error exporting PDF:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.get('/reset-password', (req, res) => {
  res.sendFile(__dirname + '/public/reset-password.html');
});

app.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  try {
    const user = await User.findOne({
      where: {
        resetToken: token,
        resetTokenExpires: { [Sequelize.Op.gt]: new Date() }
      }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await user.update({
      password: hashedPassword,
      resetToken: null,
      resetTokenExpires: null
    });

    res.status(200).json({ message: 'Password reset successful', redirectUrl: '/login' });
  } catch (error) {
    console.error('Password reset failed:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

