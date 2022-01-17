// Import all these modules
const fs = require("fs");
const path = require("path");
const arg = require("arg");
const chalk = require("chalk");
const plist = require("plist");
const sharp = require("sharp");
const trash = require("trash");

// Elapsed seconds
let elapsed = 0;
// Task is finished
let finished = false;
// Text currently in terminal
let terminal = "";

/**
 * @typedef TextureAtlas
 * @property {{ [key: string]: Frame }} frames
 * @property {Metadata} metadata
 *
 * @typedef Frame
 * @property {string[]} aliases
 * @property {string} spriteOffset
 * @property {string} spriteSize
 * @property {string} spriteSourceSize
 * @property {string} textureRect
 * @property {boolean} textureRotated
 *
 * @typedef Metadata
 * @property {number} format
 * @property {string} pixelFormat
 * @property {boolean} premultiplyAlpha
 * @property {string} realTextureFileName
 * @property {string} size
 * @property {string} smartupdate
 * @property {string} textureFileName
 */

// We'll list fatal signals
const signals = [
    "SIGABRT",
    "SIGALRM",
    "SIGHUP",
    "SIGINT",
    "SIGTERM"
]

// If the user is not on windows, list these as well
if (process.platform != "win32") {
    signals.push(
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
    );
}

/**
 * Format seconds into a notated string
 * @param {number} sec
 * @param {boolean} colon
 */
function formatSeconds(sec, colon = true) {
    let round = sec > 0 ? Math.floor : Math.ceil;

    let hours = round(sec / 3600).toString();
    let minutes = (round(sec / 60) % 60).toString();
    let seconds = (round(sec) % 60).toString();
    return (
        colon ?
        (hours.length < 2 ? hours.padStart(2, "0") : hours) + ":" + minutes.padStart(2, "0") + ":" + seconds.padStart(2, "0") :
        (hours != "0" ? hours + "h " : "") + (minutes != "0" ? minutes + "m " : "") + seconds + "s"
    );
}

/**
 * Initialize the default settings if the settings don't exist
 * @param {string} settingsFile
 */
function initSettings(settingsFile) {
    // Get location of Steam
    let defaultPath = "";
    switch (process.platform) {
        case "win32":
            defaultPath = process.arch.endsWith("64") ? process.env["ProgramFiles(x86)"] : process.env.ProgramFiles;
            break;
        case "darwin":
            defaultPath = path.join(process.env.HOME, "Library", "Application Support");
            break;
    }

    // Add the rest of the path
    defaultPath = path.join(
        defaultPath,
        "Steam",
        "steamapps",
        "common",
        process.platform == "darwin" ? "Geometry Dash.app" : "Geometry Dash"
    );
    if (process.platform == "darwin")
        defaultPath = path.join(defaultPath, "Contents");
    defaultPath = path.join(defaultPath, "Resources");

    // Save settings
    fs.writeFileSync(settingsFile, "{\n    \"resourcePath\": \"" + defaultPath.replace(/\\/g, "\\\\") + "\"\n}");
}

/**
 * Turns input into a path.
 * @param {string} input
 */
function inputToPath(input) {
    return path.resolve(process.cwd(), input.replace(/:|\*|\?|"|<|>|\|/g, "_"));
}

/**
 * Check if a keyword exists in the texture atlas
 * @param {TextureAtlas} atlas
 * @param {string} keyword
 */
 function keywordExists(atlas, keyword) {
    let entries = Object.entries(atlas.frames);
    let exists = entries.map(x => x[0]).includes(keyword);
    let realName = exists ? keyword : "";

    if (!exists) {
        for (let [fileName, sprite] of Object.entries(atlas.frames)) {
            if (sprite.aliases.map(x => x.endsWith(".png") ? x : x + ".png").includes(keyword)) {
                exists = true;
                realName = fileName;
                break;
            }
        }
    }

    return { exists, realName };
}

/**
 * We don't want to clog the terminal, so we do this instead
 * @param {string} str
 */
 function log(str) {
    process.stdout.write("\u001b[2K" + str + "\u001b[G");
}

/**
 * Inform the user that an error occurred, then close program
 * @param {Error} error
 */
function logError(error) {
    console.error(chalk.red.bold("ERROR ") + error.message);
    process.exit(1);
}

/**
 * The juicy part, saves all sprites of spritesheet to directory
 * @param {TextureAtlas} atlas
 * @param {string} resourcePath
 * @param {string} outDir
 */
async function parseSheet(atlas, resourcePath, outDir) {
    // The number of saved sprites
    let saved = 0;
    // The spritesheet buffer, as we don't want to read it over and over again
    let spritesheet = fs.readFileSync(path.join(resourcePath, atlas.metadata.realTextureFileName));
    // The spritesheet data as a array of key/value arrays
    let entries = Object.entries(atlas.frames);
    // The longest sprite name's length
    let longest = Math.max(...entries.map(x => x[0].length));

    // Check if the directory actually exists
    if (!fs.existsSync(outDir))
        // It doesn't, so let's make it ourselves
        fs.mkdirSync(outDir);
    else if (fs.statSync(outDir).isFile()) {
        // This user is trying to test us, not letting them get away with it
        await trash(outDir);
        fs.mkdirSync(outDir);
    }

    // Now let's iterate through the spritesheet data to save every sprite
    for (let [fileName, sprite] of entries) {
        // Increment number of saved sprites
        saved++;

        // Get x, y, w, h values, and then log basic sprite info
        let [ x, y, w, h ] = rectToArray(sprite.textureRect);
        if (w < 1 || h < 1)
            continue;

        terminal = 
                fileName.padEnd(longest) +
                " (x: " + x.toString().padStart(4) +
                ", y: " + y.toString().padStart(4) +
                ", w: " + w.toString().padStart(4) +
                ", h: " + h.toString().padStart(4) +
                ") " +
                (saved + "/" + entries.length).padStart(entries.length.toString().length * 2 + 1);

        log(terminal + " " + formatSeconds(elapsed));

        // In case there are aliases, save those
        for (let alias of sprite.aliases)
            await saveSprite(atlas, spritesheet, fileName, path.join(outDir, alias));

        // Finally, we save the main sprite
        await saveSprite(atlas, spritesheet, fileName, path.join(outDir, fileName));
    }

    // Inform the user that the task has is finished
    finished = true;
    let finishedText = "Finished saving " + saved + " sprites to " + outDir + " in " + formatSeconds(elapsed, false) + ".";
    log((finishedText.length < 53 + longest) ? finishedText.padEnd(53 + longest) : finishedText);
    console.log();
}

/**
 * Turns a rect value into an array
 * @param {string} str
 */
function rectToArray(str) {
    return str.replace(/{|}/g, "").split(",").map(z => parseInt(z));
}

/**
 * Saves the sprite to a directory
 * @param {TextureAtlas} atlas
 * @param {Buffer} spritesheet
 * @param {string} keyword
 * @param {string} outDir
 */
async function saveSprite(atlas, spritesheet, keyword, outPath) {
    // Get sprite info, then get texture rect
    let sprite = atlas.frames[keyword];
    let [ x, y, w, h ] = rectToArray(sprite.textureRect);

    // Save sprite
    fs.writeFileSync(
        outPath, 
        await sharp(spritesheet)
        .extract({ left: x, top: y, width: sprite.textureRotated ? h : w, height: sprite.textureRotated ? w : h })
        .rotate(sprite.textureRotated ? 270 : 0)
        .png()
        .toBuffer()
    );
}

// All the cli logic
module.exports = async function cli() {
    // Check if the user has Windows or MacOS
    if (process.platform != "win32" && process.platform != "darwin")
        // They don't, so let's close the program
        return console.log("This program only works on Windows and MacOS!\nTry again when you are on Windows or MacOS.");

    /**
     * We'll add some args for more versatility
     * @type {arg.Result<{
     *     "--help": BooleanConstructor,
     *     "--info": StringConstructor,
     *     "--json": BooleanConstructor,
     *     "--output": StringConstructor,
     *     "--save": StringConstructor,
     *     "-h": "--help",
     *     "-i": "--info",
     *     "-j": "--json",
     *     "-o": "--output",
     *     "-s": "--save"
     * }>}
     */
    let args;
    try {
        args = arg({
            "--help": Boolean,
            "--info": String,
            "--json": Boolean,
            "--output": String,
            "--save": String,
            "-h": "--help",
            "-i": "--info",
            "-j": "--json",
            "-o": "--output",
            "-s": "--save"
        });
    } catch (error) {
        logError(error);
    }
    
    // Let's check if the settings file exists
    let settingsFile = path.join(process.env[process.platform == "win32" ? "USERPROFILE" : "HOME"], "gd-plist-parser.json");
    if (!fs.existsSync(settingsFile))
        // No it doesn't, so let's make it ourselves
        initSettings(settingsFile);
    else if (fs.statSync(settingsFile).isDirectory()) {
        // This user is trying to test us, not letting them get away with it
        await trash(settingsFile);
        initSettings(settingsFile);
    }

    // Then we're sure it exists, so we'll parse the settings
    let settings = { resourcePath: "" };
    try {
        settings = JSON.parse(fs.readFileSync(settingsFile).toString());
    } catch (error) {
        // Malformed JSON...
        logError(new Error("Malformed settings JSON"));
    }

    // If there are no args, display the help menu
    if (!process.argv[2] || args["--help"]) {
        return console.log(
            "   ____ ____    ____  _ _     _     ____\n" +
            "  / ___|  _ \\  |  _ \\| (_)___| |_  |  _ \\ __ _ _ __ ___  ___ _ __\n" +
            " | |  _| | | | | |_) | | / __| __| | |_) / _` | '__/ __|/ _ \\ '__|\n" +
            " | |_| | |_| | |  __/| | \\__ \\ |_  |  __/ (_| | |  \\__ \\  __/ |\n" +
            "  \\____|____/  |_|   |_|_|___/\\__| |_|   \\__,_|_|  |___/\\___|_|\n" +
            "CLI that parses property list files linking Geometry Dash spritesheets.\n" +
            "\n" +
            "Usage: gd-plist-parser (plist) [option]\n" +
            "\n" +
            "Options:\n" +
            "--help/-h:           Display this help menu.\n" +
            "--info/-i (keyword): Display info of the sprite corresponding to the given keyword.\n" +
            "--json/-j:           Save the plist file as a crisp and beautiful JSON.\n" +
            "--output/-o (path):  Set the output path to save the file to.\n" +
            "--save/-s (keyword): Save the sprite corresponding to the given keyword.\n" +
            "\n" +
            "Settings Path: " + settingsFile + "\n" +
            "Geometry Dash Resource Path: " + settings.resourcePath
        );
    }

    // Then we'll listen for when they close the program so messages won't disappear after termination
    for (let signal of signals) {
        process.on(signal, () => {
            console.log("\nProcess interrupted");
            process.exit();
        });
    }

    // And then we'll check if the plist actually exists
    let plistPath = path.join(settings.resourcePath, args._[0]);
    if (!fs.existsSync(plistPath) || fs.statSync(plistPath).isDirectory())
        // It doesn't...
        logError(new Error("Nonexistent PLIST document"));

    /**
     * Alright, enough of that, let's start parsing
     * @type {TextureAtlas}
     */
    let atlas = {};
    try {
        atlas = plist.parse(fs.readFileSync(plistPath).toString());
    } catch (error) {
        // Malformed PLIST...
        logError(new Error("Malformed PLIST document"));
    }

    // Then we'll do the argument check (This is going to look like yandere code but whatever)
    if (args["--info"]) {
        // Check if keyword exists
        let exists = keywordExists(atlas, args["--info"]);
        if (!exists.exists)
            // It doesn't...
            logError(new Error("Keyword does not exist in spritesheet"));

        // Log the info
        return console.log(
            Object.entries(atlas.frames[exists.realName])
            .filter(x => !Array.isArray(x[1]))
            .map(x => x[0][0].toUpperCase() + x[0].slice(1).split(/(?=[A-Z])/).join(" ") + ": " + (typeof x[1] == "boolean" ? x[1] ? "Yes" : "No" : x[1]))
            .join("\n")
        );
    } else if (args["--json"]) {
        // Locate where we want to place the JSON file
        let output = args["--output"] ?
        inputToPath(args["--output"].endsWith(".json") ? args["--output"] : path.join(args["--output"], args._[0].split(".").slice(0, -1).join(".") + ".json")) :
        path.join(process.cwd(), args._[0].split(".").slice(0, -1).join(".") + ".json");

        // Let's check if the output directory exists
        let outputDir = output.split(path.sep).slice(0, -1).join(path.sep);
        if (!fs.existsSync(outputDir))
            // It doesn't, so let's make it ourselves
            fs.mkdirSync(outputDir);
        else if (fs.statSync(outputDir).isFile()) {
            // This user is trying to test us, not letting them get away with it
            await trash(outputDir);
            fs.mkdirSync(outputDir);
        }

        // Save JSON file then inform user
        fs.writeFileSync(output, JSON.stringify(atlas, null, 4));
        return console.log("JSON file written to " + output + ".");
    } else if (args["--save"]) {
        // Check if keyword exists
        let exists = keywordExists(atlas, args["--save"]);
        if (!exists.exists)
            // It doesn't...
            logError(new Error("Keyword does not exist in spritesheet"));

        // Locate where we want to place the sprite
        let output = args["--output"] ?
        inputToPath(args["--output"].endsWith(".png") ? args["--output"] : path.join(args["--output"], args["--save"])) :
        path.join(process.cwd(), args["--save"]);

        // Let's check if the output directory exists
        let outputDir = output.split(path.sep).slice(0, -1).join(path.sep);
        if (!fs.existsSync(outputDir))
            // It doesn't, so let's make it ourselves
            fs.mkdirSync(outputDir);
        else if (fs.statSync(outputDir).isFile()) {
            // This user is trying to test us, not letting them get away with it
            await trash(outputDir);
            fs.mkdirSync(outputDir);
        }

        // Save sprite then inform user that sprite has been saved
        await saveSprite(atlas, fs.readFileSync(path.join(settings.resourcePath, atlas.metadata.realTextureFileName)), exists.realName, output);
        return console.log("Sprite written to " + output + ".");
    } else {
        // Log the elapsed time
        setInterval(() => {
            if (!finished)
                log(terminal + " " + formatSeconds(elapsed++));
            else
                process.exit();
        }, 1000);

        // Locate where we want to place the sprites
        let output = args["--output"] ?
        inputToPath(args["--output"]) :
        path.join(process.cwd(), atlas.metadata.realTextureFileName.split(".").slice(0, -1).join("."));

        // Let's check if the output directory exists
        if (!fs.existsSync(output))
            // It doesn't, so let's make it ourselves
            fs.mkdirSync(output);
        else if (fs.statSync(output).isFile()) {
            // This user is trying to test us, not letting them get away with it
            await trash(output);
            fs.mkdirSync(output);
        }

        // Log output directory
        console.log("Output directory: " + output);

        // Save all sprites
        await parseSheet(atlas, settings.resourcePath, output);
    }
}