const bcrypt = require('bcryptjs');
const hash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lCqi';
bcrypt.compare('Bali@123', hash).then(r => {
    console.log('Hash valid:', r);
    if (!r) {
        // Generate a fresh hash
        const fresh = bcrypt.hashSync('Bali@123', 10);
        console.log('Fresh hash:', fresh);
    }
});
