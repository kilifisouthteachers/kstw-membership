const express = require('express');
const router = express.Router();

router.get('/csv', (req, res) => {
    res.send('Export CSV route');
});

router.get('/pdf', (req, res) => {
    res.send('Export PDF route');
});

router.get('/excel', (req, res) => {
    res.send('Export Excel route');
});

module.exports = router;
