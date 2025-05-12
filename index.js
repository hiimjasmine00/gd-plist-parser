// Import all these modules
import fs from "fs";
import path from "path";
import arg from "arg";
import chalk from "chalk";
import plist from "plist";
import sharp from "sharp";

// Hello! This is Justin from 2024 here. It's been two and a half years since I have touched
// this code, and since Geometry Dash 2.2 has finally been released, I have decided to update
// this to correct a few oversights I made when I was 13. It's crazy the amount of comments
// I wrote, but they're quite helpful. Let's get started!

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
 * Turns input into a path.
 * @param {string} input
 */
function inputToPath(input) {
    return path.resolve(process.cwd(), input.replace(/:|\*|\?|"|<|>|\|/g, "_"));
}

/**
 * Make the directory if it doesn't exist
 * @param {string} directory 
 */
async function mkdir(directory) {
    // Check if the directory actually exists
    if (!fs.existsSync(directory))
        // It doesn't, so let's make it ourselves
        fs.mkdirSync(directory);
    else if (fs.statSync(directory).isFile()) {
        // This user must have tried to beat the system...
        fs.rmSync(directory);
        fs.mkdirSync(directory);
    }
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
 * @param {string} texturePath
 * @param {string} outDir
 * @param {boolean} compress
 */
async function parseSheet(atlas, texturePath, outDir, compress) {
    // The number of saved sprites
    let saved = 0;
    // The spritesheet buffer, as we don't want to read it over and over again
    let spritesheet = fs.readFileSync(texturePath);
    // The spritesheet data as a array of key/value arrays
    let entries = Object.entries(atlas.frames);
    // The longest sprite name's length
    let longest = Math.max(...entries.map(x => x[0].length));

    // Now let's iterate through the spritesheet data to save every sprite
    for (let [fileName, sprite] of entries) {
        // Increment number of saved sprites
        saved++;

        // Get x, y, w, h values, and then log basic sprite info
        let [ x, y ] = rectToArray(sprite.textureRect);
        let [ w, h ] = rectToArray(sprite.spriteSourceSize);
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

        // Finally, we save the main sprite
        await saveSprite(atlas, spritesheet, fileName, path.join(outDir, fileName), compress);
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
 * @param {boolean} compress
 */
async function saveSprite(atlas, spritesheet, keyword, outPath, compress) {
    // Get sprite info, then get texture rect
    let sprite = atlas.frames[keyword];
    let [ offsetX, offsetY ] = rectToArray(sprite.spriteOffset);
    let [ width, height ] = rectToArray(sprite.spriteSourceSize);
    let [ x, y, w, h ] = rectToArray(sprite.textureRect);

    // Save sprite, making sure to respect the offset
    let absoluteWidth = !compress && width >= w;
    let absoluteHeight = !compress && height >= h;
    fs.writeFileSync(
        outPath, 
        await sharp({ create: {
            width: absoluteWidth ? width : w,
            height: absoluteHeight ? height : h,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        } }).composite([{
                input: await sharp(spritesheet)
                    .extract({ left: x, top: y, width: sprite.textureRotated ? h : w, height: sprite.textureRotated ? w : h })
                    .rotate(sprite.textureRotated ? 270 : 0)
                    .png()
                    .toBuffer(),
                left: absoluteWidth ? Math.round((width - w) / 2) + offsetX : 0,
                top: absoluteHeight ? Math.round((height - h) / 2) - offsetY : 0
            }])
            .png()
            .toBuffer()
    );
}

// All the cli logic
export default async function cli() {
    /**
     * We'll add some args for more versatility
     * @type {arg.Result<{
     *     "--help": BooleanConstructor,
     *     "--info": StringConstructor,
     *     "--json": BooleanConstructor,
     *     "--output": StringConstructor,
     *     "--save": StringConstructor,
     *     "--compress": BooleanConstructor,
     *     "-h": "--help",
     *     "-i": "--info",
     *     "-j": "--json",
     *     "-o": "--output",
     *     "-s": "--save",
     *     "-c": "--compress"
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
            "--compress": Boolean,
            "-h": "--help",
            "-i": "--info",
            "-j": "--json",
            "-o": "--output",
            "-s": "--save",
            "-c": "--compress"
        });
    } catch (error) {
        logError(error);
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
            "--compress/-c:       Compress the sprite to the sprite's size in the spritesheet.\n"
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
    let plistPath = path.resolve(process.cwd(), args._[0]);
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
        if (Object.entries(atlas.frames).filter(x => x[0] == args["--info"]).length <= 0)
            // It doesn't...
            logError(new Error("Keyword does not exist in spritesheet"));

        // Log the info
        return console.log(
            Object.entries(atlas.frames[args["--info"]])
            .filter(x => !Array.isArray(x[1]))
            .map(x => x[0][0].toUpperCase() + x[0].slice(1).split(/(?=[A-Z])/).join(" ") + ": " + (typeof x[1] == "boolean" ? x[1] ? "Yes" : "No" : x[1]))
            .join("\n")
        );
    } else if (args["--json"]) {
        // Locate where we want to place the JSON file
        let output = args["--output"] ?
        inputToPath(args["--output"].endsWith(".json") ? args["--output"] : path.join(args["--output"], args._[0].split(".").slice(0, -1).join(".") + ".json")) :
        path.resolve(process.cwd(), args._[0].split(".").slice(0, -1).join(".") + ".json");

        // Make the directory if it doesn't exist
        await mkdir(output.split(path.sep).slice(0, -1).join(path.sep));

        // Save JSON file then inform user
        fs.writeFileSync(output, JSON.stringify(atlas, null, 4));
        return console.log("JSON file written to " + output + ".");
    } else if (args["--save"]) {
        // Check if keyword exists
        if (Object.entries(atlas.frames).filter(x => x[0] == args["--save"]).length <= 0)
            // It doesn't...
            logError(new Error("Keyword does not exist in spritesheet"));

        // Locate where we want to place the sprite
        let output = args["--output"] ?
        inputToPath(args["--output"].endsWith(".png") ? args["--output"] : path.join(args["--output"], args["--save"])) :
        path.resolve(process.cwd(), args["--save"]);

        // Make the directory if it doesn't exist
        await mkdir(output.split(path.sep).slice(0, -1).join(path.sep));

        // Save sprite then inform user that sprite has been saved
        await saveSprite(atlas, fs.readFileSync(plistPath.split(".").slice(0, -1).join(".") + ".png"),  args["--save"], output, args["--compress"]);
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
        let texturePath = path.resolve(process.cwd(), plistPath.split(".").slice(0, -1).join("."));
        let output = args["--output"] ? inputToPath(args["--output"]) : texturePath

        // Make the directory if it doesn't exist
        await mkdir(output);

        // Log output directory
        console.log("Output directory: " + output);

        // Save all sprites
        await parseSheet(atlas, texturePath + ".png", output, args["--compress"]);
    }
}
