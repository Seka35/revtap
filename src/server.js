require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const clientRoutes = require('./routes/client');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
}));

app.get('/', (req, res) => res.redirect('/admin'));

app.use('/r', publicRoutes);
app.use('/admin', adminRoutes);
app.use('/client', clientRoutes);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`NFC review tracker running on port ${port}`);
});
