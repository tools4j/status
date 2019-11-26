var configId = 0;

class Status {
    constructor(configJsonPath, outputToHtmlElement) {
        this.outputToHtmlElement = outputToHtmlElement;
        this.checksByPath = {};
        this.checkParseSpec = {
            name: {propertyName: "name"},
            link: {propertyName: "link"},
            status: {propertyName: "status"},
            statusText: {propertyName: "statusText"},
            statusToolTip: {propertyName: "link"}
        };
        this.sleepBetweenChecksMs = 5000;
        let that = this;
        this.fetchConfig(configJsonPath).then(function (config) {
            that.parseStructure(config);
            that.startChecking();
        })
    }

    fetchConfig(configJsonPath) {
        return new Promise(function (resolve) {
            $.ajax({
                url: configJsonPath,
                type: "GET",
                timeout: 10000
            }).done(function (data, statusText, jqXHR) {
                console.log("Fetched config at: " + configJsonPath + ":" + statusText + ":" + jqXHR.status);
                resolve(data);
            }).fail(function (jqXHR, statusText, errorThrown) {
                throw Error("Failed to fetch jsons config: " + configJsonPath + ":" + statusText + ":" + errorThrown + ":" + jqXHR.status)
            });
        });
    }

    parseStructure(config) {
        if (config["sleepBetweenChecksMs"] != null) {
            this.sleepBetweenChecksMs = config.sleepBetweenChecksMs
        }
        this.outputToHtmlElement.innerHTML = this.parseChildren(config, 0, "" + configId++, this.checkParseSpec);
    }

    parseChildren(parent, level, path, checkParseSpec) {
        var returnStr = ""
        if (parent['parseSpec'] != null) {
            checkParseSpec = parent.parseSpec;
        }
        if (parent['group'] != null) {
            returnStr += this.parseGroup(parent.group, level, path, checkParseSpec)
        } else if (parent['checks'] != null) {
            returnStr += this.parseChecks(parent, path, checkParseSpec);
        }
        return returnStr;
    }

    parseGroup(group, level, path, checkParseSpec) {
        console.info("Parsing group: " + group)
        if (group['parseSpec'] != null) {
            checkParseSpec = parent.parseSpec;
        }
        var returnStr = `<div class='group groupLevel${level}' id="group_${path}">`;
        var groupIndex = 0;
        for(let groupItem of group){
            returnStr += `<h${level + 1}>${groupItem.heading}</h${level + 1}>`;
            let groupPath = path + "_" + groupIndex;
            returnStr += this.parseChildren(groupItem, level + 1, groupPath, checkParseSpec);
            groupIndex++;
        }
        returnStr += "</div>";
        return returnStr
    }

    parseChecks(group, path, checkParseSpec) {
        var returnStr = "";
        var checkIndex = 0;
        let checks = [];
        returnStr += `<div class="checks" id="checks_${path}">\n`;
        group.checks.forEach(function (check) {
            if (check['parseSpec'] == null) {
                check.parseSpec = checkParseSpec;
            }
            returnStr += `<a href="${check.url}" class="status status-dummy" target="_blank">${check.name}</a>`;
            checks.push(check);
            checkIndex++;
        });
        returnStr += `</div>`;
        this.checksByPath[path] = checks;
        return returnStr;
    }

    async startChecking() {
        while (true) {
            console.info("Checking...")
            for (var path in this.checksByPath) {
                console.info("Checking: " + path)
                this.doChecks(path)
            }
            await sleep(this.sleepBetweenChecksMs)
        }
    }

    doChecks(path) {
        let checksByPathElement = this.checksByPath[path];
        var promises = [];
        for (var i = 0; i < checksByPathElement.length; i++) {
            console.log(checksByPathElement[i]);
            promises.push(this.doCheck(checksByPathElement[i]));
        }
        Promise.all(promises).then(function (results) {
            console.info("Finished all: " + results.length)
            var resultsStr = ""
            for (const result of results) {
                try {
                    resultsStr += result.render() + "\n";
                } catch (error) {
                    console.error(error)
                    resultsStr += renderStatus(null, "Error", error.message, error.message, "status-error")
                }
            }
            $("#checks_" + path)[0].innerHTML = resultsStr;
        });
    }

    doCheck(check) {
        return new Promise(function (resolve) {
            $.ajax({
                url: check.url,
                type: "GET",
                timeout: 10000
            }).done(function (data, statusText, jqXHR) {
                console.log("Complete: " + check.url + ":" + statusText + ":" + jqXHR.status);
                if (check.parse) {
                    resolve(new ParsedResult(check, data))
                } else {
                    resolve(new OkResult(check, statusText))
                }
            }).fail(function (jqXHR, statusText, errorThrown) {
                console.log("Failed: " + check.url + ":" + statusText + ":" + errorThrown + ":" + jqXHR.status)
                resolve(new ErrorResult(check, statusText, jqXHR.status))
            });
        });
    }
}

class ParsedResult {
    constructor(check, data){
        this.check = check;
        this.data = data;
    }

    render(){
        var resultStr = "";

        if(isArray(this.data)){
            for(var element of this.data){
                resultStr += this.renderJsonElement(element)
            }
        } else {
            resultStr += this.renderJsonElement(this.data)
        }
        return resultStr
    }

    renderJsonElement(jsonElement){
        let parseSpec = this.check.parseSpec;
        return renderStatus(
            this.resolveProperty(jsonElement, parseSpec.link),
            this.resolveProperty(jsonElement, parseSpec.name),
            this.resolveProperty(jsonElement, parseSpec.statusText),
            this.resolveProperty(jsonElement, parseSpec.statusToolTip),
            parseSpec["statusCssClasses"] != null
                ? this.resolveProperty(jsonElement, parseSpec.statusCssClasses)
                : `status-${this.resolveProperty(jsonElement, parseSpec.status)}`);
    }

    resolveProperty(jsonElement, propertyParseSpec){
        if(propertyParseSpec["propertyName"] != null){
            return jsonElement[propertyParseSpec.propertyName];
        } else if(propertyParseSpec["asCode"] != null){
            return eval(propertyParseSpec.asCode)
        } else {
            throw Error("Could not find 'propertyName' or 'asCode' in jsonElement " + jsonElement)
        }
    }
}

class OkResult {
    constructor(check, statusText){
        this.check = check;
        this.statusText = (statusText == null ? "OK": statusText);
    }

    render(){
        return renderStatus(
            this.check.url,
            this.check.name,
            this.statusText,
            `${this.check.url}`,
            `status-ok status-200`);
    }
}

class ErrorResult {
    constructor(check, statusText, statusCode){
        this.check = check;
        this.statusText = statusText;
        this.statusCode = statusCode;
    }

    render(){
        return renderStatus(
            this.check.url,
            this.check.name,
            this.statusText,
            `Fetch of url ${this.check.url} failed with statusCode [${this.statusCode}] with message [${this.statusText}]`,
            `status-error status-${this.statusCode}`);
    }
}

function renderStatus(statusLink, statusName, statusText, statusTooltip, statusCssClasses ){
    return `<a href="${statusLink == null ? "#": statusLink}" class="status ${statusCssClasses}"
                     target="_blank" 
                     ${statusTooltip == null ? "": `title="${statusTooltip}">`}
                     <span class="name">${statusName}</span>
                     ${statusText == null ? "": `<span class="status-text">${statusText}</span>`}
                </a>`
}

function isArray(jsonElement) {
    return Object.prototype.toString.call(jsonElement) === '[object Array]';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}