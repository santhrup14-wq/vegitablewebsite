const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// --- Environment Variables (Reading from process.env) ---
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'production';

// Check if required environment variables are set
if (!MONGODB_URI) {
    console.error('MONGODB_URI environment variable is not set!');
    process.exit(1);
}

console.log('Environment variables loaded:');
console.log('- MONGODB_URI:', MONGODB_URI ? 'Set' : 'Not set');
console.log('- NODE_ENV:', NODE_ENV);
console.log('- PORT:', PORT);

// --- Database Connection ---
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log("Successfully connected to MongoDB.");
    console.log(`Environment: ${NODE_ENV}`);
}).catch(err => {
    console.error("Connection error", err);
    process.exit(1); // Exit if database connection fails
});

// --- Mongoose Schemas ---
const vegetableSchema = new mongoose.Schema({
    name: String, 
    district: String, 
    market: String,
    highPrice: Number, 
    lowPrice: Number, 
    date: String,
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
    
    jwt.verify(token,             process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- Health Check Route ---
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        environment: NODE_ENV,
        timestamp: new Date().toISOString()
    });
});

// --- API Routes ---
// Get all districts and their markets
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
        console.error("Markets route error:", error);
        res.status(500).json({ message: "Failed to fetch market data." });
    }
});

// Get dropdown data for forms
app.get('/api/dropdown-data', async (req, res) => {
    try {
        const vegetables = await Vegetable.distinct('name').sort();
        const pipeline = [
            { $group: { _id: "$district", markets: { $addToSet: "$market" } } }
        ];
        const result = await Vegetable.aggregate(pipeline);
        const districtMarkets = result.reduce((acc, item) => {
            if (item._id) { 
                acc[item._id] = item.markets.sort(); 
            }
            return acc;
        }, {});
        res.json({ vegetables, districtMarkets });
    } catch (error) {
        console.error("Error fetching dropdown data:", error);
        res.status(500).json({ message: "Failed to fetch dropdown data." });
    }
});

// Search vegetables
app.get('/api/search', async (req, res) => {
    try {
        const results = await Vegetable.find(req.query);
        res.json(results);
    } catch (error) { 
        console.error("Search error:", error);
        res.status(500).json({ error: 'Database error' }); 
    }
});

// --- AUTHENTICATION ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, district, market } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: "Username already exists." });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword, district, market });
        await newUser.save();
        
        res.status(201).json({ message: "User registered successfully!" });
    } catch (error) { 
        console.error("Registration error:", error);
        res.status(500).json({ message: "Registration failed." }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: "Invalid credentials." });
        }
        
        const token = jwt.sign(
            { 
                id: user._id, 
                username: user.username, 
                district: user.district, 
                market: user.market 
            },
            JWT_SECRET, 
            { expiresIn: '24h' }
        );
        
        res.json({ 
            token,
            user: {
                username: user.username,
                district: user.district,
                market: user.market
            }
        });
    } catch (error) { 
        console.error("Login error:", error);
        res.status(500).json({ message: "Server error." }); 
    }
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
    } catch (error) { 
        console.error("Fetch items error:", error);
        res.status(500).json({ message: "Failed to fetch items." }); 
    }
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
    try {
        const updatedItem = await Vegetable.findByIdAndUpdate(
            req.params.id, 
            req.body, 
            { new: true }
        );
        if (!updatedItem) {
            return res.status(404).json({ message: "Item not found." });
        }
        res.json(updatedItem);
    } catch (error) {
        console.error("Update item error:", error);
        res.status(500).json({ message: "Failed to update item." });
    }
});

app.delete('/api/admin/delete/:id', authenticateToken, async (req, res) => {
    try {
        const deletedItem = await Vegetable.findByIdAndDelete(req.params.id);
        if (!deletedItem) {
            return res.status(404).json({ message: "Item not found." });
        }
        res.json({ message: 'Item deleted successfully' });
    } catch (error) {
        console.error("Delete item error:", error);
        res.status(500).json({ message: "Failed to delete item." });
    }
});

// --- Error Handling Middleware ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: "Something went wrong!" });
});

// --- 404 Handler ---
app.use('*', (req, res) => {
    res.status(404).json({ message: "Route not found" });
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
});
