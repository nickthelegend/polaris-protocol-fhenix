try {
    const relayer = require("@fhenix-fhe/relayer-sdk");
    console.log("Success! Relayer SDK keys:", Object.keys(relayer));
} catch (e) {
    console.error("Failed to import @fhenix-fhe/relayer-sdk:", e);
}
