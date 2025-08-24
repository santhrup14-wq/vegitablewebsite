const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// --- Database Connection ---
mongoose.connect('mongodb://localhost:27017/vegetableDB', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log("Successfully connected to MongoDB."))
  .catch(err => console.error("Connection error", err));

const JWT_SECRET = 'your-super-secret-key-that-is-long-and-secure';

// --- Mongoose Schemas ---
const vegetableSchema = new mongoose.Schema({
    name: String, district: String, market: String,
    highPrice: Number, lowPrice: Number, date: String,
});
const Vegetable = mongoose.model('Vegetable', vegetableSchema);

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    district: { type: String, required: true },
    market: { type: String, required: true },
});
const User = mongoose.model('User', userSchema);

// --- Authentication Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- THIS IS THE REQUIRED ROUTE THAT WAS LIKELY MISSING ---
// It provides a structured list of all districts and their unique markets.
app.get('/api/markets', async (req, res) => {
    try {
        const pipeline = [
            { $group: { _id: "$district", markets: { $addToSet: "$market" } } }
        ];
        const result = await Vegetable.aggregate(pipeline);
        const districtMarkets = result.reduce((acc, item) => {
            acc[item._id] = item.markets.sort();
            return acc;
        }, {});
        res.json(districtMarkets);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch market data." });
    }
});
// This route provides the dynamic data for all dropdown menus
app.get('/api/dropdown-data', async (req, res) => {
    try {
        const vegetables = await Vegetable.distinct('name').sort();
        const pipeline = [ { $group: { _id: "$district", markets: { $addToSet: "$market" } } } ];
        const result = await Vegetable.aggregate(pipeline);
        const districtMarkets = result.reduce((acc, item) => {
            if (item._id) { acc[item._id] = item.markets.sort(); }
            return acc;
        }, {});
        res.json({ vegetables, districtMarkets });
    } catch (error) {
        console.error("Error fetching dropdown data:", error);
        res.status(500).json({ message: "Failed to fetch dropdown data." });
    }
});
// This route handles the main search functionality
app.get('/api/search', async (req, res) => {
    try {
        const results = await Vegetable.find(req.query);
        res.json(results);
    } catch (error) { res.status(500).json({ error: 'Database error' }); }
});


// --- AUTHENTICATION ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, district, market } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword, district, market });
        await newUser.save();
        res.status(201).json({ message: "User registered successfully!" });
    } catch (error) { res.status(500).json({ message: "Registration failed." }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: "Invalid credentials." });
        }
        const token = jwt.sign(
            { id: user._id, username: user.username, district: user.district, market: user.market },
            JWT_SECRET, { expiresIn: '1h' }
        );
        res.json({ token });
    } catch (error) { res.status(500).json({ message: "Server error." }); }
});


// --- PROTECTED ADMIN ROUTES ---
app.get('/api/admin/items', authenticateToken, async (req, res) => {
    try {
        const { market } = req.query;
        let filter = { district: req.user.district };
        if (market && market !== 'All') {
            filter.market = market;
        }
        const items = await Vegetable.find(filter).sort({ date: -1 });
        res.json(items);
    } catch (error) { res.status(500).json({ message: "Failed to fetch items." }); }
});

app.post('/api/admin/add', authenticateToken, async (req, res) => {
    try {
        const userDistrict = req.user.district;
        const newItemData = { ...req.body, district: userDistrict };
        const newVegetable = new Vegetable(newItemData);
        await newVegetable.save();
        res.status(201).json(newVegetable);
    } catch (error) {
        console.error("Add item error:", error);
        res.status(500).json({ message: "Failed to add item." });
    }
});

app.put('/api/admin/update/:id', authenticateToken, async (req, res) => {
    const updatedItem = await Vegetable.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedItem);
});

app.delete('/api/admin/delete/:id', authenticateToken, async (req, res) => {
    await Vegetable.findByIdAndDelete(req.params.id);
    res.json({ message: 'Item deleted successfully' });
});

// --- Server Start ---
const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));