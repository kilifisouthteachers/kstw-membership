const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'kstw_user',
  password: 'Kkk24041980',
  database: 'kstw_db'
});

connection.connect(error => {
  if (error) {
    return console.error('error connecting: ' + error.stack);
  }
  console.log('connected as id ' + connection.threadId);
});

connection.end();
