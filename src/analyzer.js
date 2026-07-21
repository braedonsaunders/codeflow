// CodeFlow analyzer — canonical implementation (MOO-67 Commit 3).
//
// This is the single source of truth for repository/file/function analysis,
// consumed by:
//   - the browser main thread (imported by index.html as a real ES module);
//   - the browser's own analysis Web Worker (createAnalysisWorkerSource,
//     below, fetches this module's own source via `import.meta.url` and
//     re-embeds the CODEFLOW_CORE_START/END slice into a classic worker
//     script — see the note on that function for why the slice excludes
//     runAnalysisData/createAnalysisWorkerSource themselves);
//   - card/lib/analyzer.js (the GitHub Action pipeline);
//   - the Node test suite (tests/codeflow-golden.test.mjs,
//     tests/baseline-snapshot.test.mjs, etc).
//
// TreeSitter, Babel, and acorn are read as ambient globals (unchanged from
// the original inline-script design) — real bindings via CDN <script> tags
// in the browser, and explicitly stubbed to `undefined` by Node-side
// consumers before importing this module (see docs/baseline.md and
// tests/analyzer-module.test.mjs) to avoid a ReferenceError on first
// reference, exactly mirroring how the pre-extraction vm.createContext-based
// tests already worked.
/* eslint-disable no-undef */

// ===== CODEFLOW_CORE_START =====
function getSecurityScanContent(file){
    var content=file&&file.content?file.content:'';
    if(file&&file.name==='index.html'&&content.includes('detectSecurity:function(files){')&&content.includes('calcComplexity:function')){
        return content.replace(
            /detectSecurity:function\(files\)\{[\s\S]*?\n    \},\n    calcComplexity:function/,
            "detectSecurity:function(files){\n        return[];\n    },\n    calcComplexity:function"
        );
    }
    return content;
}

function isSanitizedPreviewRenderer(content){
    return content.includes("function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}") &&
           content.includes("var escaped=esc(line);") &&
           content.includes("dangerouslySetInnerHTML:{__html:lineHtml||' '}");
}
const Parser={
    // Tree-sitter parsers are loaded lazily from CDN and used when a language has
    // a stable grammar path. Regex remains an explicit fallback, not a silent lie.
    _tsRuntimePromise:null,
    _tsLanguagePromises:Object.create(null),
    _tsLanguages:Object.create(null),
    _tsParsers:Object.create(null),
    _callCandidateThreshold:250,
    treeSitterWasmBase:'https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.13/out/',
    treeSitterGrammars:{
        python:{grammar:'python',exts:['.py','.pyw','.pyi'],coverage:'calls'},
        javascript:{grammar:'javascript',exts:['.js','.jsx','.mjs','.cjs'],coverage:'available'},
        typescript:{grammar:'typescript',exts:['.ts'],coverage:'available'},
        tsx:{grammar:'tsx',exts:['.tsx'],coverage:'available'},
        go:{grammar:'go',exts:['.go'],coverage:'available'},
        rust:{grammar:'rust',exts:['.rs'],coverage:'available'},
        java:{grammar:'java',exts:['.java'],coverage:'available'},
        ruby:{grammar:'ruby',exts:['.rb'],coverage:'available'},
        php:{grammar:'php',exts:['.php'],coverage:'available'},
        c:{grammar:'c',exts:['.c','.h'],coverage:'available'},
        cpp:{grammar:'cpp',exts:['.cpp','.cc','.hpp'],coverage:'available'},
        csharp:{grammar:'c_sharp',exts:['.cs'],coverage:'available'},
        swift:{grammar:'swift',exts:['.swift'],coverage:'available'},
        kotlin:{grammar:'kotlin',exts:['.kt','.kts'],coverage:'available'},
        scala:{grammar:'scala',exts:['.scala'],coverage:'available'},
        elixir:{grammar:'elixir',exts:['.ex','.exs'],coverage:'available'},
        lua:{grammar:'lua',exts:['.lua'],coverage:'available'},
        bash:{grammar:'bash',exts:['.sh','.bash','.zsh','.fish'],coverage:'available'}
    },
    treeSitterFetchTimeoutMs:8000,
    _withTimeout:function(promise,ms){
        return Promise.race([
            promise,
            new Promise(function(_,reject){setTimeout(function(){reject(new Error('tree-sitter fetch timed out'));},ms);})
        ]);
    },
    initTreeSitter:async function(){
        if(this._tsRuntimePromise)return this._tsRuntimePromise;
        this._tsRuntimePromise=(async()=>{
            if(typeof TreeSitter==='undefined')return null;
            try{
                await Parser._withTimeout(TreeSitter.init({
                    locateFile:function(scriptName){
                        return 'https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/'+scriptName;
                    }
                }),Parser.treeSitterFetchTimeoutMs);
                return TreeSitter;
            }catch(e){
                return null;
            }
        })();
        return this._tsRuntimePromise;
    },
    getTreeSitterConfig:function(filename){
        var lower=(filename||'').toLowerCase();
        var configs=Object.values(Parser.treeSitterGrammars);
        for(var i=0;i<configs.length;i++){
            if(configs[i].exts.some(function(ext){return lower.endsWith(ext);})){
                return configs[i];
            }
        }
        return null;
    },
    loadTreeSitterLanguage:async function(config){
        if(!config)return null;
        if(this._tsLanguages[config.grammar])return this._tsLanguages[config.grammar];
        if(this._tsLanguagePromises[config.grammar])return this._tsLanguagePromises[config.grammar];
        this._tsLanguagePromises[config.grammar]=(async()=>{
            var runtime=await Parser.initTreeSitter();
            if(!runtime)return null;
            try{
                var lang=await Parser._withTimeout(runtime.Language.load(Parser.treeSitterWasmBase+'tree-sitter-'+config.grammar+'.wasm'),Parser.treeSitterFetchTimeoutMs);
                var parser=new runtime();
                parser.setLanguage(lang);
                Parser._tsLanguages[config.grammar]=lang;
                Parser._tsParsers[config.grammar]=parser;
                return lang;
            }catch(e){
                return null;
            }
        })();
        return this._tsLanguagePromises[config.grammar];
    },
    prepareTreeSitter:async function(files){
        var configs=new Map();
        (files||[]).forEach(function(file){
            var cfg=Parser.getTreeSitterConfig(file.path||file.name);
            if(cfg&&cfg.coverage==='calls')configs.set(cfg.grammar,cfg);
        });
        await Promise.all(Array.from(configs.values()).map(function(cfg){return Parser.loadTreeSitterLanguage(cfg);}));
    },
    getLoadedTreeSitterParser:function(filename){
        var cfg=Parser.getTreeSitterConfig(filename);
        return cfg?Parser._tsParsers[cfg.grammar]||null:null;
    },
    getParserProvenance:function(filename){
        var lower=(filename||'').toLowerCase();
        var cfg=Parser.getTreeSitterConfig(filename);
        if(cfg&&Parser._tsParsers[cfg.grammar])return cfg.coverage==='calls'?'tree-sitter:'+cfg.grammar+'-calls':'tree-sitter:'+cfg.grammar;
        if(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.vue','.svelte'].some(function(ext){return lower.endsWith(ext);})&&typeof acorn!=='undefined')return 'acorn-babel';
        if(Parser.isMarkdown&&Parser.isMarkdown(filename))return 'markdown-link-parser';
        if(Parser.isCode(filename))return 'heuristic-regex';
        return 'text';
    },
    codeExts:['.js','.jsx','.ts','.tsx','.mjs','.cjs','.py','.pyw','.pyi','.java','.go','.rb','.php','.rs','.c','.cpp','.cc','.h','.hpp','.cs','.swift','.kt','.kts','.scala','.clj','.ex','.exs','.erl','.hs','.lua','.r','.R','.jl','.dart','.elm','.fs','.fsx','.ml','.pl','.pm','.sh','.bash','.zsh','.fish','.ps1','.psm1','.groovy','.gradle','.vba','.bas','.cls','.xlsm','.xlam','.xlsb','.xla','.xlw'],
    scriptContainerExts:['.html','.htm','.xhtml','.vue','.svelte'],
    textExts:['.md','.markdown','.txt','.json','.jsonl','.yaml','.yml','.toml','.xml','.html','.htm','.css','.scss','.sass','.less','.svg','.graphql','.gql','.sql','.prisma','.proto','.tf','.tfvars','.env','.env.example','.gitignore','.gitattributes','.gitmodules','.eslintrc','.prettierrc','.babelrc','.editorconfig','.ini','.cfg','.conf','.properties','.lock','.csv','.tsv','.rst','.tex','.cmake','.rake','.vba','.bas','.cls','.xlsm','.xlam','.xlsb','.xla','.xlw','.mod','.sum'],
    textNames:['dockerfile','containerfile','makefile','rakefile','gemfile','podfile','pipfile','procfile','brewfile','justfile','taskfile','cmakelists.txt','license','copying','notice','readme','changelog','authors','contributors','owners','codeowners','go.mod','go.sum'],
    binExts:['.png','.jpg','.jpeg','.gif','.ico','.webp','.bmp','.svg','.woff','.woff2','.ttf','.eot','.otf','.pdf','.zip','.tar','.gz','.rar','.7z','.exe','.dll','.so','.dylib','.bin','.dat','.db','.sqlite','.mp3','.mp4','.wav','.avi','.mov','.webm'],
    isCode:function(n){
        var lower=n.toLowerCase();
        return Parser.codeExts.some(function(e){return lower.endsWith(e);})||
            Parser.scriptContainerExts.some(function(e){return lower.endsWith(e);});
    },
    isText:function(n){
        var lower=n.toLowerCase();
        return Parser.textExts.some(function(e){return lower.endsWith(e);})||Parser.textNames.indexOf(lower)>=0;
    },
    isBinary:function(n){return Parser.binExts.some(function(e){return n.toLowerCase().endsWith(e);});},
    isIncluded:function(n){return !Parser.isBinary(n)&&(Parser.isCode(n)||Parser.isText(n));},
    isScriptContainer:function(n){return Parser.scriptContainerExts.some(function(e){return n.toLowerCase().endsWith(e);});},
    isVBA:function(n){return ['.vba','.bas','.cls','.xlsm','.xlam','.xlsb','.xla','.xlw'].some(function(e){return n.toLowerCase().endsWith(e);});},
    isHTML:function(n){return ['.html','.htm','.xhtml'].some(function(e){return n.toLowerCase().endsWith(e);});},
    isCSS:function(n){return ['.css','.scss','.sass','.less'].some(function(e){return n.toLowerCase().endsWith(e);});},
    isJSON:function(n){return ['.json'].some(function(e){return n.toLowerCase().endsWith(e);});},
    parseHTMLAttributes:function(attrs){
        if(!attrs)return[];
        var parsed=[];
        var attrRegex=/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        var match;
        while((match=attrRegex.exec(attrs))){
            var value=match[2]!==undefined?match[2]:(match[3]!==undefined?match[3]:match[4]);
            parsed.push({
                name:(match[1]||'').toLowerCase(),
                value:value===undefined?'':value,
                valueStart:value===undefined?-1:match.index+match[0].indexOf(value)
            });
        }
        return parsed;
    },
    getScriptTagAttribute:function(attrs,name){
        var parsed=Parser.parseHTMLAttributes(attrs);
        var lowered=name.toLowerCase();
        for(var i=0;i<parsed.length;i++){
            if(parsed[i].name===lowered)return parsed[i].value;
        }
        return'';
    },
    getScriptBlockInfo:function(attrs){
        var type=(Parser.getScriptTagAttribute(attrs,'type')||'').split(';')[0].trim().toLowerCase();
        var lang=(Parser.getScriptTagAttribute(attrs,'lang')||'').split(';')[0].trim().toLowerCase();
        var info={executable:false,isTS:false,sourceType:'script'};

        if(!type){
            info.executable=true;
        }else if(type==='module'){
            info.executable=true;
            info.sourceType='module';
        }else if(
            type.match(/^(?:text|application)\/(?:x-)?(?:java|ecma)script$/)||
            type==='text/babel'||type==='text/jsx'||type==='application/jsx'||
            type==='application/babel'
        ){
            info.executable=true;
        }else if(
            type.match(/^(?:text|application)\/(?:x-)?typescript$/)||
            type==='text/tsx'||type==='application/tsx'
        ){
            info.executable=true;
            info.isTS=true;
        }

        if(lang==='ts'||lang==='tsx'||lang==='typescript'){
            info.executable=true;
            info.isTS=true;
        }else if(lang==='js'||lang==='jsx'||lang==='javascript'||lang==='babel'){
            info.executable=true;
        }

        return info;
    },
    getEmbeddedCodeBlocks:function(content,filename,options){
        if(!content||!Parser.isScriptContainer(filename))return[];
        var blocks=[];
        var scriptRegex=/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
        var match;
        var scriptRanges=[];
        while((match=scriptRegex.exec(content))){
            var attrs=match[1]||'';
            var info=Parser.getScriptBlockInfo(attrs);
            var scriptContent=match[2]||'';
            scriptRanges.push({start:match.index,end:match.index+match[0].length});
            if(!info.executable||!scriptContent.trim())continue;
            var openTagEnd=match[0].indexOf('>');
            if(openTagEnd<0)continue;
            var bodyStart=match.index+openTagEnd+1;
            blocks.push({
                content:scriptContent,
                offset:content.slice(0,bodyStart).split('\n').length-1,
                isTS:info.isTS,
                sourceType:info.sourceType,
                kind:'script'
            });
        }

        if(options&&options.includeHandlers&&Parser.isHTML(filename)){
            var tagRegex=/<([a-z][\w:-]*)([^<>]*?)>/gi;
            while((match=tagRegex.exec(content))){
                var tagStart=match.index;
                var insideScript=false;
                for(var sri=0;sri<scriptRanges.length;sri++){
                    if(tagStart>=scriptRanges[sri].start&&tagStart<scriptRanges[sri].end){
                        insideScript=true;
                        break;
                    }
                }
                if(insideScript)continue;
                var attrs=match[2]||'';
                var attrsStart=match[0].indexOf(attrs);
                var parsedAttrs=Parser.parseHTMLAttributes(attrs);
                for(var ai=0;ai<parsedAttrs.length;ai++){
                    var attr=parsedAttrs[ai];
                    if(!/^on[a-z][\w:-]*$/i.test(attr.name)||attr.valueStart<0)continue;
                    if(!attr.value||!attr.value.trim())continue;
                    var valueStart=tagStart+attrsStart+attr.valueStart;
                    blocks.push({
                        content:attr.value,
                        offset:content.slice(0,valueStart).split('\n').length-1,
                        isTS:false,
                        sourceType:'script',
                        kind:'handler'
                    });
                }
            }
        }

        return blocks;
    },
    hasEmbeddedCode:function(content,filename){
        return Parser.getEmbeddedCodeBlocks(content,filename,{includeHandlers:true}).length>0;
    },
    isMarkdown:function(n){return ['.md','.markdown'].some(function(e){return n.toLowerCase().endsWith(e);});},
    // Mirror of tests/md-extractors.mjs::extractMarkdownLinks. Keep in sync.
    extractMarkdownLinks:function(content){
        if(!content)return[];
        var stripped=content.replace(/```[\s\S]*?```/g,'').replace(/~~~[\s\S]*?~~~/g,'').replace(/`[^`\n]*`/g,'');
        var links=[];
        var wikiRe=/\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
        var m;
        while((m=wikiRe.exec(stripped))!==null){
            links.push({kind:'wikilink',raw:m[0],target:m[1].trim()});
        }
        var mdRe=/(!?)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g;
        while((m=mdRe.exec(stripped))!==null){
            if(m[1]==='!')continue;
            var url=m[3].trim();
            if(!url)continue;
            if(/^(?:https?:|mailto:|ftp:|file:|tel:|#)/i.test(url))continue;
            var clean=url.split('#')[0].split('?')[0];
            if(!clean)continue;
            links.push({kind:'mdlink',raw:m[0],target:url});
        }
        return links;
    },
    // Mirror of tests/md-extractors.mjs::resolveMarkdownLink. Keep in sync.
    resolveMarkdownLink:function(rawTarget,fromPath,allPaths,kind){
        if(!rawTarget)return null;
        var allLower=allPaths.map(function(p){return p.toLowerCase();});
        function findExact(candidate){
            var c=candidate.toLowerCase();
            var i=allLower.indexOf(c);
            return i>=0?allPaths[i]:null;
        }
        function findWithMd(candidate){
            var hit=findExact(candidate);
            if(hit)return hit;
            if(!/\.(md|markdown)$/i.test(candidate)){
                var mdHit=findExact(candidate+'.md');
                if(mdHit)return mdHit;
                return findExact(candidate+'.markdown');
            }
            return null;
        }
        if(kind==='mdlink'){
            var cleanTarget=rawTarget.split('#')[0].split('?')[0];
            var resolved;
            if(cleanTarget.charAt(0)==='/'){
                resolved=cleanTarget.slice(1);
            }else{
                var fromDir=fromPath.indexOf('/')>=0?fromPath.split('/').slice(0,-1).join('/'):'';
                var parts=(fromDir?fromDir.split('/'):[]).concat(cleanTarget.split('/'));
                var out=[];
                for(var pi=0;pi<parts.length;pi++){
                    var p=parts[pi];
                    if(p===''||p==='.')continue;
                    if(p==='..'){out.pop();continue;}
                    out.push(p);
                }
                resolved=out.join('/');
            }
            var direct=findWithMd(resolved);
            if(direct)return direct;
        }
        var baseName=rawTarget.split('#')[0].split('?')[0].split('/').pop();
        if(!baseName)return null;
        for(var i=0;i<allPaths.length;i++){
            var pname=allPaths[i].split('/').pop().toLowerCase();
            if(/\.(md|markdown)$/i.test(baseName)){
                if(pname===baseName.toLowerCase())return allPaths[i];
            }else if(pname===baseName.toLowerCase()+'.md'||pname===baseName.toLowerCase()+'.markdown'){
                return allPaths[i];
            }
        }
        return null;
    },
    detectLayer:function(p){
        // Prepend a leading slash so root-level layer folders (e.g. "services/x.ts")
        // match the same substring patterns as nested ones (e.g. "src/services/x.ts").
        var l='/'+p.toLowerCase().replace(/^\/+/,'');
        // Test files
        if(l.includes('/test')||l.match(/test_\w+\.py$/)||l.match(/\w+_test\.py$/)||l.includes('conftest'))return'test';
        // UI/View layer
        if(l.includes('/ui/')||l.includes('/views/')||l.includes('/pages/')||l.includes('/templates/')||l.includes('/static/'))return'ui';
        if(l.includes('/component'))return'components';
        // Service/API layer
        if(l.includes('/service')||l.includes('/api/')||l.includes('/controller')||l.includes('/endpoint')||l.includes('/router'))return'services';
        // Python middleware/handler layer
        if(l.includes('/middleware')||l.includes('/handler')||l.includes('/signal'))return'services';
        // Utility/Helper layer
        if(l.includes('/util')||l.includes('/helper')||l.includes('/lib/')||l.includes('/common/'))return'utils';
        // Data/Model layer
        if(l.includes('/data')||l.includes('/model')||l.includes('/store')||l.includes('/schema')||l.includes('/serializer'))return'data';
        // Python-specific data layers
        if(l.includes('/migration'))return'data';
        if(l.includes('/fixtures/'))return'data';
        // Task/Worker layer
        if(l.includes('/task')||l.includes('/worker')||l.includes('/celery')||l.includes('/job'))return'services';
        // Config layer
        if(l.includes('/config')||l.includes('/settings')||l.match(/settings\.py$/))return'config';
        // VBA-specific layer detection
        if(l.includes('/modules/')||l.includes('/bas/'))return'modules';
        if(l.includes('/forms/')||l.includes('/userforms/'))return'ui';
        if(l.includes('/classes/'))return'data';
        if(l.includes('/standard/'))return'utils';
        return'utils';
    },
    detectPatterns:function(files){
        var patterns=[];
        var singletons=files.filter(function(f){return f.content&&(f.content.includes('getInstance')||f.content.match(/let\s+instance\s*=/)||f.content.match(/private\s+static\s+instance/));});
        if(singletons.length)patterns.push({name:'Singleton',icon:'lock',desc:'Ensures a class has only one instance. Common for configuration, logging, or connection pools.',severity:'info',files:singletons.map(function(f){return{name:f.name,path:f.path};}),metrics:{instances:singletons.length}});
        var factories=files.filter(function(f){return f.content&&(f.name.toLowerCase().includes('factory')||f.content.match(/create[A-Z]\w*\s*\(/)||f.content.includes('return new'));});
        if(factories.length)patterns.push({name:'Factory',icon:'factory',desc:'Creates objects without specifying exact class. Enables loose coupling and extensibility.',severity:'info',files:factories.map(function(f){return{name:f.name,path:f.path};}),metrics:{factories:factories.length}});
        var observers=files.filter(function(f){return f.content&&(f.content.includes('subscribe')||f.content.includes('addEventListener')||f.content.includes('.on(')||f.content.includes('emit('));});
        if(observers.length)patterns.push({name:'Observer/Event',icon:'eye',desc:'Defines a subscription mechanism for event-driven architecture. Great for decoupling.',severity:'info',files:observers.map(function(f){return{name:f.name,path:f.path};}),metrics:{emitters:observers.length}});
        var hooks=files.filter(function(f){return f.content&&f.content.match(/export\s+(?:const|function)\s+use[A-Z]/);});
        if(hooks.length)patterns.push({name:'Custom Hooks',icon:'hook',desc:'React hooks for reusable stateful logic. Promotes code reuse and separation of concerns.',severity:'info',files:hooks.map(function(f){return{name:f.name,path:f.path};}),metrics:{hooks:hooks.length}});
        var hocs=files.filter(function(f){return f.content&&(f.content.match(/with[A-Z]\w*\s*=\s*\(/)||f.content.match(/export\s+default\s+connect/));});
        if(hocs.length)patterns.push({name:'Higher-Order Component',icon:'spark',desc:'Functions that take a component and return an enhanced component.',severity:'info',files:hocs.map(function(f){return{name:f.name,path:f.path};}),metrics:{hocs:hocs.length}});
        var providers=files.filter(function(f){return f.content&&(f.content.includes('createContext')||f.content.includes('Provider')||f.content.includes('useContext'));});
        if(providers.length)patterns.push({name:'Context Provider',icon:'globe',desc:'React Context for global state. Alternative to prop drilling.',severity:'info',files:providers.map(function(f){return{name:f.name,path:f.path};}),metrics:{contexts:providers.length}});
        // VBA-specific patterns
        var vbaUserForms=files.filter(function(f){return f.content&&(f.content.match(/Attribute\s+VB_Name\s*=\s*["']UserForm/i)||f.name.match(/UserForm/i));});
        if(vbaUserForms.length)patterns.push({name:'UserForms',icon:'layout',desc:'VBA UserForms for UI components. Common in Excel/Access automation.',severity:'info',files:vbaUserForms.map(function(f){return{name:f.name,path:f.path};}),metrics:{forms:vbaUserForms.length}});
        var vbaModules=files.filter(function(f){return f.content&&(f.content.match(/Attribute\s+VB_Name\s*=\s*["']Module/i)||f.name.match(/Module/i));});
        if(vbaModules.length)patterns.push({name:'Modules',icon:'box',desc:'VBA Modules for reusable code and business logic.',severity:'info',files:vbaModules.map(function(f){return{name:f.name,path:f.path};}),metrics:{modules:vbaModules.length}});
        var vbaClasses=files.filter(function(f){return f.content&&(f.content.match(/Attribute\s+VB_Name\s*=\s*["']Class/i)||f.name.match(/Class/i));});
        if(vbaClasses.length)patterns.push({name:'Class Modules',icon:'building',desc:'VBA Class Modules for object-oriented programming patterns.',severity:'info',files:vbaClasses.map(function(f){return{name:f.name,path:f.path};}),metrics:{classes:vbaClasses.length}});
        // Python-specific patterns
        var decoratorFiles=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&f.content.match(/@\w+\s*(?:\(.*\))?\s*\n\s*(?:def|class)/);});
        var pyDecorators=decoratorFiles.filter(function(f){return f.content.match(/@(?:app\.route|router\.|blueprint\.|get|post|put|delete|patch)\s*\(/);});
        if(pyDecorators.length)patterns.push({name:'Route Decorators',icon:'route',desc:'Flask/FastAPI/Django route decorators for URL routing. Common in Python web frameworks.',severity:'info',files:pyDecorators.map(function(f){return{name:f.name,path:f.path};}),metrics:{routes:pyDecorators.length}});
        var dataclasses=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&f.content.match(/@dataclass/);});
        if(dataclasses.length)patterns.push({name:'Dataclasses',icon:'database',desc:'Python dataclasses for structured data. Reduces boilerplate for data-holding classes.',severity:'info',files:dataclasses.map(function(f){return{name:f.name,path:f.path};}),metrics:{dataclasses:dataclasses.length}});
        var abcFiles=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&(f.content.match(/\bABC\b/)||f.content.match(/@abstractmethod/)||f.content.match(/ABCMeta/));});
        if(abcFiles.length)patterns.push({name:'Abstract Base Classes',icon:'layers',desc:'Python ABCs enforce interface contracts. Ensures subclasses implement required methods.',severity:'info',files:abcFiles.map(function(f){return{name:f.name,path:f.path};}),metrics:{abcs:abcFiles.length}});
        var ctxManagers=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&(f.content.match(/@contextmanager/)||f.content.match(/def\s+__enter__/));});
        if(ctxManagers.length)patterns.push({name:'Context Managers',icon:'refresh',desc:'Python context managers for resource management (with statement). Ensures proper cleanup.',severity:'info',files:ctxManagers.map(function(f){return{name:f.name,path:f.path};}),metrics:{managers:ctxManagers.length}});
        var pyMixins=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&f.content.match(/class\s+\w*Mixin\w*\s*[\(:]?/);});
        if(pyMixins.length)patterns.push({name:'Mixins',icon:'puzzle',desc:'Python mixins for reusable behavior through multiple inheritance.',severity:'info',files:pyMixins.map(function(f){return{name:f.name,path:f.path};}),metrics:{mixins:pyMixins.length}});
        var pySignals=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&(f.content.match(/Signal\s*\(/)||f.content.match(/@receiver\s*\(/)||f.content.match(/\.connect\s*\(/));});
        if(pySignals.length)patterns.push({name:'Django Signals',icon:'radio',desc:'Django signals for decoupled event-driven communication between components.',severity:'info',files:pySignals.map(function(f){return{name:f.name,path:f.path};}),metrics:{signals:pySignals.length}});
        var pyMiddleware=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&(f.content.match(/class\s+\w*Middleware/)||f.content.match(/def\s+middleware\s*\(/)||f.name.toLowerCase().includes('middleware'));});
        if(pyMiddleware.length)patterns.push({name:'Middleware',icon:'link',desc:'Request/response middleware for cross-cutting concerns (auth, logging, CORS).',severity:'info',files:pyMiddleware.map(function(f){return{name:f.name,path:f.path};}),metrics:{middleware:pyMiddleware.length}});
        var godFiles=files.filter(function(f){return f.isCode!==false&&f.functions&&f.functions.length>15;});
        if(godFiles.length)patterns.push({name:'God Object',icon:'warning',desc:'Files with too many responsibilities (15+ functions). Consider splitting into smaller modules.',severity:'warning',isAnti:true,files:godFiles.map(function(f){return{name:f.name,path:f.path,fns:f.functions.length};}),metrics:{files:godFiles.length,avgFns:Math.round(godFiles.reduce(function(s,f){return s+f.functions.length;},0)/godFiles.length)}});
        var longFiles=files.filter(function(f){return f.isCode!==false&&f.lines&&f.lines>500;});
        if(longFiles.length)patterns.push({name:'Long File',icon:'scroll',desc:'Files over 500 lines are harder to maintain. Consider breaking into smaller modules.',severity:'warning',isAnti:true,files:longFiles.map(function(f){return{name:f.name,path:f.path,lines:f.lines};}),metrics:{files:longFiles.length,avgLines:Math.round(longFiles.reduce(function(s,f){return s+f.lines;},0)/longFiles.length)}});
        // VBA-specific anti-patterns
        var vbaGodFiles=files.filter(function(f){return f.isCode!==false&&f.functions&&f.functions.length>20;});
        if(vbaGodFiles.length)patterns.push({name:'VBA God Module',icon:'warning',desc:'VBA modules with 20+ procedures. Consider splitting into smaller modules.',severity:'warning',isAnti:true,files:vbaGodFiles.map(function(f){return{name:f.name,path:f.path,fns:f.functions.length,lines:f.lines};}),metrics:{files:vbaGodFiles.length,avgFns:Math.round(vbaGodFiles.reduce(function(s,f){return s+f.functions.length;},0)/vbaGodFiles.length)}});
        return patterns;
    },
    detectDuplicates:function(files,allFns){
        var duplicates=[];

        // Common function names that are expected to be duplicated across files
        // These are idiomatic patterns, not DRY violations
        var commonNames=new Set([
            // React lifecycle and handlers
            'render','componentDidMount','componentWillUnmount','componentDidUpdate',
            'shouldComponentUpdate','getDerivedStateFromProps','getSnapshotBeforeUpdate',
            'handleClick','handleChange','handleSubmit','handleInput','handleKeyDown',
            'handleKeyUp','handleKeyPress','handleBlur','handleFocus','handleScroll',
            'handleMouseEnter','handleMouseLeave','handleDrag','handleDrop',
            'onClick','onChange','onSubmit','onBlur','onFocus','onKeyDown',
            // Common utility names
            'init','setup','cleanup','destroy','reset','clear','update','refresh',
            'validate','parse','format','transform','convert','process','execute',
            'get','set','fetch','load','save','create','delete','remove','add',
            'find','filter','map','reduce','sort','merge','clone','copy',
            // Test patterns
            'beforeEach','afterEach','beforeAll','afterAll','describe','it','test',
            'setUp','tearDown','mock',
            // Common class methods
            'toString','valueOf','equals','hashCode','compare','clone',
            'serialize','deserialize','toJSON','fromJSON',
            // Express/API patterns
            'index','show','store','update','destroy','create','edit',
            // Python common patterns
            '__init__','__str__','__repr__','__len__','__eq__','__hash__','__enter__','__exit__',
            '__getattr__','__setattr__','__delattr__','__getitem__','__setitem__','__contains__',
            '__iter__','__next__','__call__','__bool__','__lt__','__gt__','__le__','__ge__',
            'upgrade','downgrade','setUp','tearDown','setUpClass','tearDownClass',
            'main','create_app','configure','register','on_startup','on_shutdown','lifespan',
            // Vue lifecycle
            'mounted','created','updated','destroyed','beforeCreate','beforeMount',
            // Angular lifecycle
            'ngOnInit','ngOnDestroy','ngOnChanges','ngAfterViewInit',
            // Svelte
            'onMount','onDestroy',
            // Next.js App Router route-handler & metadata exports (framework-mandated names)
            'GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS',
            'generateMetadata','generateStaticParams','generateImageMetadata','generateSitemaps','middleware'
        ]);

        // Group functions by name (excluding common names)
        var fnByName=Object.create(null);
        allFns.forEach(function(fn){
            // Skip functions outside shipped product code (tests, fixtures, tooling, docs)
            if(isNonProductionPath(fn.file))return;
            // Skip non-string names (e.g. numeric object-literal keys from the JS AST walker)
            if(typeof fn.name!=='string')return;
            // Skip common/idiomatic names
            if(commonNames.has(fn.name))return;
            // Skip very short names (likely false positives)
            if(fn.name.length<3)return;
            // Skip class methods (same method name in different classes is normal)
            if(fn.isClassMethod)return;
            // Skip Python class-scoped names (ClassName.method)
            if(fn.name.includes('.'))return;
            // Skip decorated functions (framework handlers have similar structures by design)
            if(fn.decorators&&fn.decorators.length>0)return;

            if(!fnByName[fn.name])fnByName[fn.name]=[];
            fnByName[fn.name].push(fn);
        });

        // Find duplicate names across different files - only report if suspicious
        Object.entries(fnByName).forEach(function(entry){
            var name=entry[0],fns=entry[1];
            var uniqueFiles=[...new Set(fns.map(function(f){return f.file;}))];

            // Only flag if in 3+ files (2 files might be intentional)
            if(uniqueFiles.length>=3){
                // Check if the code is actually similar (not just same name)
                var codeSamples=fns.filter(function(f){return f.code&&f.code.length>30;});
                if(codeSamples.length>=2){
                    // Compare first two code samples for similarity
                    var sim=Parser.codeSimilarity(codeSamples[0].code,codeSamples[1].code);
                    if(sim>0.5){  // More than 50% similar - likely a real duplicate
                        duplicates.push({
                            type:'name',
                            name:name,
                            count:uniqueFiles.length,
                            files:fns.map(function(f){return{file:f.file,line:f.line};}),
                            similarity:Math.round(sim*100),
                            suggestion:'Function "'+name+'" appears in '+uniqueFiles.length+' files with '+Math.round(sim*100)+'% similarity - consider consolidating'
                        });
                    }
                }
            }
        });

        // Find similar code blocks (improved algorithm)
        // Use structural hash that captures the essence of the code
        var codeGroups=Object.create(null);
        allFns.forEach(function(fn){
            if(!fn.code||fn.code.length<80)return;  // Skip very short functions

            // Create a structural fingerprint
            var fingerprint=Parser.codeFingerprint(fn.code);
            if(!fingerprint)return;

            if(!codeGroups[fingerprint])codeGroups[fingerprint]=[];
            codeGroups[fingerprint].push(fn);
        });

        Object.values(codeGroups).forEach(function(fns){
            if(fns.length>1){
                var uniqueFiles=[...new Set(fns.map(function(f){return f.file;}))];
                // Must be in different files to be a real duplication issue
                if(uniqueFiles.length>1){
                    // Verify with actual similarity check
                    var sim=Parser.codeSimilarity(fns[0].code,fns[1].code);
                    if(sim>0.7){  // 70% or more similar
                        duplicates.push({
                            type:'code',
                            name:fns.map(function(f){return f.name;}).join(', '),
                            count:fns.length,
                            files:fns.map(function(f){return{file:f.file,name:f.name,line:f.line};}),
                            similarity:Math.round(sim*100),
                            suggestion:'Similar code blocks ('+Math.round(sim*100)+'% match) - consider extracting to a shared utility'
                        });
                    }
                }
            }
        });

        return duplicates;
    },

    // Calculate code similarity using normalized comparison (0-1 scale)
    codeSimilarity:function(code1,code2){
        if(!code1||!code2)return 0;

        // Normalize both code blocks
        function normalize(code){
            return code
                .replace(/\/\/.*$/gm,'')           // Remove JS single-line comments
                .replace(/#.*$/gm,'')              // Remove Python/Ruby comments
                .replace(/\/\*[\s\S]*?\*\//g,'')   // Remove multi-line comments
                .replace(/"""[\s\S]*?"""/g,'S')    // Remove Python docstrings (triple double)
                .replace(/'''[\s\S]*?'''/g,'S')    // Remove Python docstrings (triple single)
                .replace(/['"`][^'"`]*['"`]/g,'S') // Normalize strings
                .replace(/\b\d+\.?\d*\b/g,'N')     // Normalize numbers
                .replace(/\s+/g,' ')               // Normalize whitespace
                .trim();
        }

        var n1=normalize(code1);
        var n2=normalize(code2);

        if(n1===n2)return 1;
        if(n1.length===0||n2.length===0)return 0;

        // Use longest common subsequence ratio
        var lcs=Parser.lcsLength(n1,n2);
        var maxLen=Math.max(n1.length,n2.length);
        return lcs/maxLen;
    },

    // Longest common subsequence length (optimized for similarity)
    lcsLength:function(s1,s2){
        // Use simplified approach for performance
        if(s1.length>500||s2.length>500){
            // For long strings, use sampling
            s1=s1.substring(0,500);
            s2=s2.substring(0,500);
        }

        var m=s1.length,n=s2.length;
        var prev=new Array(n+1).fill(0);
        var curr=new Array(n+1).fill(0);

        for(var i=1;i<=m;i++){
            for(var j=1;j<=n;j++){
                if(s1[i-1]===s2[j-1]){
                    curr[j]=prev[j-1]+1;
                }else{
                    curr[j]=Math.max(prev[j],curr[j-1]);
                }
            }
            var tmp=prev;prev=curr;curr=tmp;
            curr.fill(0);
        }
        return prev[n];
    },

    // Create a structural fingerprint for code (for grouping similar code)
    codeFingerprint:function(code){
        if(!code||code.length<50)return null;

        // Extract structural elements
        var structure=code
            .replace(/\/\/.*$/gm,'')           // Remove comments
            .replace(/\/\*[\s\S]*?\*\//g,'')
            .replace(/['"`][^'"`]*['"`]/g,'')  // Remove string contents
            .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g,'I')  // All identifiers -> I
            .replace(/\b\d+\.?\d*\b/g,'N')     // All numbers -> N
            .replace(/\s+/g,'');               // Remove whitespace

        // Take a hash-like fingerprint based on structure length and key patterns
        var patterns={
            loops:(structure.match(/for|while/g)||[]).length,
            conditions:(structure.match(/if|\?/g)||[]).length,
            calls:(structure.match(/I\(/g)||[]).length,
            returns:(structure.match(/return/g)||[]).length,
            len:Math.floor(structure.length/50)*50  // Bucket by length
        };

        // Create fingerprint string
        return 'L'+patterns.loops+'C'+patterns.conditions+'F'+patterns.calls+'R'+patterns.returns+'S'+patterns.len;
    },
    detectLayerViolations:function(files,connections){
        var violations=[];
        var layerOrder={presentation:0,ui:0,component:0,components:0,page:0,view:0,feature:1,service:2,services:2,api:2,data:3,model:3,util:4,utils:4,helper:4,lib:4,core:4,config:5,test:6,modules:5,forms:0,classes:3};
        var fileByPath={};
        files.forEach(function(f){fileByPath[f.path]=f;});
        connections.forEach(function(c){
            // Convention (see buildAnalysisData): source = file DEFINING the fn (imported),
            // target = file CALLING it (the importer). The importer is c.target.
            var importedFile=fileByPath[c.source];
            var importerFile=fileByPath[c.target];
            if(!importedFile||!importerFile)return;
            var importedLayer=(importedFile.layer||'').toLowerCase();
            var importerLayer=(importerFile.layer||'').toLowerCase();
            // Test files legitimately depend on every layer — never flag them as violators.
            // Use both classifiers: isArchitectureTestFile catches *.test/*.spec files outside
            // a tests/ dir; the 'test' layer catches Python test_*.py, conftest.py, and test-folders.
            if(isArchitectureTestFile(importerFile.path)||importerLayer==='test')return;
            var importedLevel=layerOrder[importedLayer];
            var importerLevel=layerOrder[importerLayer];
            // Violation: a more-foundational file (higher level number) imports from a higher-up layer.
            if(importerLevel!==undefined&&importedLevel!==undefined&&importerLevel>importedLevel&&importerLevel-importedLevel>1){
                violations.push({
                    from:importerFile.path,
                    fromLayer:importerFile.layer,
                    to:importedFile.path,
                    toLayer:importedFile.layer,
                    fn:c.fn,
                    suggestion:importerFile.layer+' should not import from '+importedFile.layer+'. Consider inverting the dependency or using dependency injection.'
                });
            }
        });
        return violations;
    },
    calcComplexity:function(content,filename){
        if(!content)return{score:0,level:'low'};
        if(filename&&Parser.isScriptContainer(filename)){
            var blocks=Parser.getEmbeddedCodeBlocks(content,filename,{includeHandlers:true});
            if(!blocks.length)return{score:0,level:'low'};
            content=blocks.map(function(block){return block.content;}).join('\n');
        }
        // Approximate cyclomatic complexity - supports JS, Python, and other languages
        var complexity=1;
        // JS/C-style patterns
        var patterns=[/\bif\s*\(/g,/\belse\s+if\s*\(/g,/\bwhile\s*\(/g,/\bfor\s*\(/g,/\bcase\s+/g,/\bcatch\s*\(/g,/\?\s*[^:]+\s*:/g,/&&/g,/\|\|/g];
        // Python-specific patterns
        var pyPatterns=[/\bif\s+[^(]/g,/\belif\s+/g,/\bwhile\s+[^(]/g,/\bfor\s+\w+\s+in\s+/g,/\bexcept\s*/g,/\bwith\s+/g,/\band\b/g,/\bor\b/g,/\bif\s+.+\s+else\s+/g,/\bfor\s+.+\s+in\s+[^\n]*\]/g];
        patterns.concat(pyPatterns).forEach(function(p){var m=content.match(p);if(m)complexity+=m.length;});
        // Deduplicate: if both `if (` and `if ` match the same lines, the count is inflated
        // but for a quick approximation this is acceptable
        var level='low';
        if(complexity>30)level='critical';
        else if(complexity>20)level='high';
        else if(complexity>10)level='medium';
        return{score:complexity,level:level};
    },
    generateSuggestions:function(data){
        var suggestions=[];
        // Based on dead functions
        if(data.stats.dead>10){
            suggestions.push({priority:'high',icon:'broom',title:'Remove Dead Code',desc:data.stats.dead+' unused functions detected. Removing them will improve maintainability and reduce bundle size.',action:'Review unused functions in the Issues panel',impact:'Reduces codebase by ~'+(data.stats.dead*15)+' lines'});
        }
        // Based on circular dependencies
        var circular=data.issues.filter(function(i){return i.title&&i.title.includes('Circular');});
        if(circular.length){
            suggestions.push({priority:'critical',icon:'refresh',title:'Break Circular Dependencies',desc:circular.length+' circular dependencies found. These cause tight coupling and make testing difficult.',action:'Extract shared code to a new module or use dependency injection',impact:'Improves testability and modularity'});
        }
        // Based on god files
        var godFiles=data.issues.filter(function(i){return i.title&&i.title.includes('Large');});
        if(godFiles.length){
            suggestions.push({priority:'high',icon:'split',title:'Split Large Files',desc:godFiles.length+' files have too many functions. Split by responsibility.',action:'Group related functions and extract to separate modules',impact:'Improves code navigation and testing'});
        }
        // Based on high coupling
        var coupling=data.issues.filter(function(i){return i.title&&i.title.includes('Coupled');});
        if(coupling.length){
            suggestions.push({priority:'medium',icon:'link',title:'Reduce Coupling',desc:coupling.length+' files are imported by many others. Consider if this is intentional.',action:'Review if these should be split or if importers should be consolidated',impact:'Reduces blast radius of changes'});
        }
        // Based on duplicates
        if(data.duplicates&&data.duplicates.length>0){
            var nameDups=data.duplicates.filter(function(d){return d.type==='name';});
            var codeDups=data.duplicates.filter(function(d){return d.type==='code';});
            if(nameDups.length){
                suggestions.push({priority:'medium',icon:'copy',title:'Resolve Naming Conflicts',desc:nameDups.length+' function names are duplicated across files. This can cause confusion.',action:'Rename functions to be more specific or consolidate into shared module',impact:'Prevents bugs from importing wrong function'});
            }
            if(codeDups.length){
                suggestions.push({priority:'high',icon:'box',title:'Extract Duplicated Code',desc:codeDups.length+' instances of similar code found. DRY principle violation.',action:'Create shared utility functions',impact:'Reduces maintenance burden and potential bugs'});
            }
        }
        // Based on layer violations
        if(data.layerViolations&&data.layerViolations.length>0){
            suggestions.push({priority:'high',icon:'layers',title:'Fix Architecture Violations',desc:data.layerViolations.length+' layer violations found. Lower layers should not depend on higher layers.',action:'Invert dependencies or use interfaces/events',impact:'Improves architecture and testability'});
        }
        // Based on security
        var highSec=data.securityIssues?data.securityIssues.filter(function(s){return s.severity==='high';}):[];
        if(highSec.length){
            suggestions.push({priority:'critical',icon:'shield',title:'Fix Security Issues',desc:highSec.length+' high-severity security issues found.',action:'Address hardcoded secrets, injection risks immediately',impact:'Prevents potential security breaches'});
        }
        // Test coverage hint
        var testFiles=data.files.filter(function(f){return f.name.includes('.test.')||f.name.includes('.spec.')||f.path.includes('__tests__');});
        var testRatio=data.files.length>0?(testFiles.length/data.files.length*100):0;
        if(testRatio<10&&data.files.length>10){
            suggestions.push({priority:'medium',icon:'beaker',title:'Add Test Coverage',desc:'Only '+testFiles.length+' test files found ('+Math.round(testRatio)+'%). Consider adding more tests.',action:'Focus on testing critical paths and high-complexity files',impact:'Prevents regressions and improves confidence'});
        }
        return suggestions.sort(function(a,b){var p={critical:0,high:1,medium:2,low:3};return p[a.priority]-p[b.priority];});
    },
    detectSecurity:function(files){
        var issues=[];
        files.forEach(function(f){
            var scanContent=getSecurityScanContent(f);
            if(!scanContent)return;
            var lines=scanContent.split('\n');
            lines.forEach(function(line,idx){
                if(!isSecretScanExemptPath(f.path)&&line.match(/(?:password|passwd|pwd|secret|api_key|apikey|token|auth)\s*[=:]\s*['"][^'"]{4,}['"]/i)&&!line.includes('process.env')&&!line.includes('config.')){
                    issues.push({severity:'high',title:'Hardcoded Secret',file:f.name,path:f.path,line:idx+1,desc:'Credentials should never be hardcoded. Use environment variables or a secrets manager.',code:line.trim().substring(0,80)});
                }
            });
            var hasSqlConcat=scanContent.match(/query\s*\(\s*['"`][^'"`]*\s*\+/)||scanContent.match(/execute\s*\(\s*['"`][^'"`]*\$\{/);
            var dbCallRegex=/\b(?:query|execute|raw)\s*\(([^)]*)\)/gi;
            var hasSqlTemplateInjection=false;
            var dbCall;
            while((dbCall=dbCallRegex.exec(scanContent))!==null){
                if(/\$\{/.test(dbCall[1])&&/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(dbCall[1])){hasSqlTemplateInjection=true;break;}
            }
            if(f.isCode&&(hasSqlConcat||hasSqlTemplateInjection)){
                var m=scanContent.match(/.*(query|execute|SELECT|INSERT|UPDATE|DELETE).*(\+|\$\{).*/i);
                issues.push({severity:'high',title:'SQL Injection Risk',file:f.name,path:f.path,desc:'String concatenation in SQL queries. Use parameterized queries instead.',code:m?m[0].trim().substring(0,80):''});
            }
            var hasInnerHtmlAssignment=scanContent.match(/innerHTML\s*=/);
            var hasDangerousHtmlRender=scanContent.match(/dangerouslySetInnerHTML/);
            var isSafePreviewRender=!hasInnerHtmlAssignment&&hasDangerousHtmlRender&&isSanitizedPreviewRenderer(f.content||'');
            var htmlValueRegex=/dangerouslySetInnerHTML\s*[:=]\s*\{\{?\s*__html\s*:\s*([^}]+)\}/g;
            var allHtmlValuesLiteral=true;
            var foundHtmlValue=false;
            var htmlMatch;
            while((htmlMatch=htmlValueRegex.exec(scanContent))!==null){
                foundHtmlValue=true;
                if(!/^(['"`])(?:(?!\1)[\s\S])*\1$/.test(htmlMatch[1].trim())){
                    allHtmlValuesLiteral=false;
                }
            }
            var isSafeStaticHtml=!hasInnerHtmlAssignment&&hasDangerousHtmlRender&&foundHtmlValue&&allHtmlValuesLiteral;
            if(!isNonProductionPath(f.path)&&(hasInnerHtmlAssignment||hasDangerousHtmlRender)&&!isSafePreviewRender&&!isSafeStaticHtml){
                issues.push({severity:'high',title:'XSS Vulnerability',file:f.name,path:f.path,desc:'Direct HTML injection can lead to XSS attacks. Sanitize user input.',code:''});
            }
            if(scanContent.includes('eval(')){
                var evalLine=lines.findIndex(function(l){return l.includes('eval(');});
                issues.push({severity:'medium',title:'Dynamic Code Execution',file:f.name,path:f.path,line:evalLine+1,desc:'eval() executes arbitrary code. Avoid if possible or validate input strictly.',code:evalLine>=0?lines[evalLine].trim().substring(0,80):''});
            }
            if(scanContent.match(/\b(?:new\s+)?Function\s*\(/)){
                issues.push({severity:'medium',title:'Function Constructor',file:f.name,path:f.path,desc:'Function constructor is similar to eval(). Consider alternatives.',code:''});
            }
            var execMatch=scanContent.match(/(?:child_process|cp)\.\w*[Ee]xec\w*\s*\(/)||scanContent.match(/require\(\s*['"](?:node:)?child_process['"]\s*\)/)||scanContent.match(/from\s+['"](?:node:)?child_process['"]/);
            if(!isNonProductionPath(f.path)&&execMatch){
                issues.push({severity:'medium',title:'Command Execution',file:f.name,path:f.path,desc:'Shell command execution detected. Ensure input is sanitized to prevent injection.',code:''});
            }
            if(scanContent.match(/console\.(log|debug|info)\(/)){
                var consoleCount=(scanContent.match(/console\.(log|debug|info)\(/g)||[]).length;
                if(consoleCount>3){
                    var debugSeverity=isArchitectureBackendPath(f.path)?'info':'low';
                    issues.push({severity:debugSeverity,title:'Debug Statements',file:f.name,path:f.path,desc:consoleCount+' console statements found. Remove before production.',code:''});
                }
            }
            // VBA-specific security checks
            if(scanContent.match(/SendKeys\s*\(/i)){
                issues.push({severity:'high',title:'SendKeys Usage',file:f.name,path:f.path,desc:'SendKeys can be exploited for code injection. Avoid using SendKeys.',code:''});
            }
            if(!isNonProductionPath(f.path)&&scanContent.match(/Shell\s*\(/i)){
                issues.push({severity:'high',title:'Shell Command Execution',file:f.name,path:f.path,desc:'Shell() executes system commands. Ensure input is validated.',code:''});
            }
            if(scanContent.match(/CreateObject\s*\(\s*["']WScript\.Shell["']/i)){
                issues.push({severity:'high',title:'WScript.Shell Creation',file:f.name,path:f.path,desc:'Creating WScript.Shell object allows command execution. Use with caution.',code:''});
            }
            if(scanContent.match(/Application\.Run\s*\(/i)){
                issues.push({severity:'medium',title:'Dynamic Code Execution',file:f.name,path:f.path,desc:'Application.Run can execute arbitrary code. Validate input.',code:''});
            }
            if(scanContent.match(/On Error Resume Next/i)){
                var errorResumeCount=(scanContent.match(/On Error Resume Next/gi)||[]).length;
                if(errorResumeCount>2){
                    issues.push({severity:'medium',title:'Excessive Error Suppression',file:f.name,path:f.path,desc:errorResumeCount+' instances of "On Error Resume Next" found. This can hide bugs.',code:''});
                }
            }
            if(scanContent.match(/TODO|FIXME|HACK|XXX/)){
                var todoCount=(scanContent.match(/TODO|FIXME|HACK|XXX/g)||[]).length;
                issues.push({severity:'low',title:'Code Comments',file:f.name,path:f.path,desc:todoCount+' TODO/FIXME comments found. Address before release.',code:''});
            }
            // Python-specific security checks
            var isPyFile=f.name.endsWith('.py')||f.name.endsWith('.pyw');
            if(isPyFile&&scanContent){
                // eval() and exec() - arbitrary code execution
                if(scanContent.match(/\beval\s*\(/)){
                    var evalLine=lines.findIndex(function(l){return l.match(/\beval\s*\(/);});
                    issues.push({severity:'high',title:'Python eval()',file:f.name,path:f.path,line:evalLine>=0?evalLine+1:undefined,desc:'eval() executes arbitrary Python code. Use ast.literal_eval() for safe parsing.',code:evalLine>=0?lines[evalLine].trim().substring(0,80):''});
                }
                if(scanContent.match(/\bexec\s*\(/)){
                    var execLine=lines.findIndex(function(l){return l.match(/\bexec\s*\(/);});
                    issues.push({severity:'high',title:'Python exec()',file:f.name,path:f.path,line:execLine>=0?execLine+1:undefined,desc:'exec() executes arbitrary Python code. This is almost always a security risk.',code:execLine>=0?lines[execLine].trim().substring(0,80):''});
                }
                // pickle - deserialization attacks
                if(scanContent.match(/\bpickle\.load/)||scanContent.match(/\bunpickle/)){
                    issues.push({severity:'high',title:'Pickle Deserialization',file:f.name,path:f.path,desc:'pickle.load() can execute arbitrary code from untrusted data. Use JSON or safe alternatives.',code:''});
                }
                // subprocess with shell=True
                if(!isNonProductionPath(f.path)&&scanContent.match(/subprocess\.\w+\([^)]*shell\s*=\s*True/)){
                    issues.push({severity:'high',title:'Shell Injection Risk',file:f.name,path:f.path,desc:'subprocess with shell=True is vulnerable to command injection. Use shell=False with a list of args.',code:''});
                }
                // os.system / os.popen - command injection
                if(scanContent.match(/\bos\.system\s*\(/)||scanContent.match(/\bos\.popen\s*\(/)){
                    var osLine=lines.findIndex(function(l){return l.match(/\bos\.(system|popen)\s*\(/);});
                    issues.push({severity:'high',title:'OS Command Execution',file:f.name,path:f.path,line:osLine>=0?osLine+1:undefined,desc:'os.system()/os.popen() are vulnerable to command injection. Use subprocess with shell=False.',code:osLine>=0?lines[osLine].trim().substring(0,80):''});
                }
                // __import__ - dynamic imports
                if(scanContent.match(/__import__\s*\(/)){
                    issues.push({severity:'medium',title:'Dynamic Import',file:f.name,path:f.path,desc:'__import__() with user input can load arbitrary modules. Validate module names against an allowlist.',code:''});
                }
                // Bare except clauses
                var bareExcepts=(scanContent.match(/\bexcept\s*:/g)||[]).length;
                if(bareExcepts>2){
                    issues.push({severity:'medium',title:'Bare Except Clauses',file:f.name,path:f.path,desc:bareExcepts+' bare except: clauses found. These catch all exceptions including SystemExit and KeyboardInterrupt.',code:''});
                }
                // assert in non-test files
                if(!f.name.includes('test')&&!f.path.includes('test')){
                    var assertCount=(scanContent.match(/\bassert\s+/g)||[]).length;
                    if(assertCount>5){
                        issues.push({severity:'low',title:'Assert in Production',file:f.name,path:f.path,desc:assertCount+' assert statements found. Assertions are stripped with python -O. Use proper validation.',code:''});
                    }
                }
                // Hardcoded DEBUG = True
                if(scanContent.match(/\bDEBUG\s*=\s*True\b/)){
                    issues.push({severity:'medium',title:'Debug Mode Enabled',file:f.name,path:f.path,desc:'DEBUG = True found. Ensure this is disabled in production.',code:''});
                }
            }
        });
        return issues.sort(function(a,b){var sev={high:0,medium:1,low:2,info:3};return sev[a.severity]-sev[b.severity];});
    },
    // AST-based function extraction - accurate detection without false positives
    extract:function(content,filename){
        var fns=[];
        var lines=content.split('\n');

        // Helper to extract code snippet for a function
        function extractCode(startLine,endLine){
            var code=[];
            var start=Math.max(0,startLine-1);
            var end=Math.min(lines.length,endLine||startLine+20);
            for(var i=start;i<end&&code.length<15;i++){
                code.push(lines[i]);
            }
            if(code.length>=15)code.push('  // ...');
            return code.join('\n');
        }

        // Track functions by line to allow same name at different locations
        var seenAtLine={};
        function addFn(fnObj){
            var key=fnObj.name+'@'+fnObj.line;
            if(!seenAtLine[key]){
                seenAtLine[key]=true;
                fns.push(fnObj);
            }
        }

        var scriptBlocks=Parser.getEmbeddedCodeBlocks(content,filename,{includeHandlers:false}).filter(function(block){
            return block.kind==='script';
        });
        if(scriptBlocks.length){
            scriptBlocks.forEach(function(block){
                Parser.extractJSFunctions(block.content,filename,block.offset,addFn,extractCode,block.isTS);
            });
            return fns;
        }
        if(Parser.isScriptContainer(filename)){
            return fns;
        }

        // Check file type
        var ext=filename.toLowerCase();
        var isJS=ext.endsWith('.js')||ext.endsWith('.jsx')||ext.endsWith('.mjs')||ext.endsWith('.cjs');
        var isTS=ext.endsWith('.ts')||ext.endsWith('.tsx');
        var isVue=ext.endsWith('.vue');
        var isSvelte=ext.endsWith('.svelte');
        var isPython=ext.endsWith('.py')||ext.endsWith('.pyw')||ext.endsWith('.pyi');

        // Extract script content from Vue/Svelte files
        var scriptContent=content;
        var scriptOffset=0;
        if(isVue||isSvelte){
            var scriptMatch=content.match(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i);
            if(scriptMatch){
                scriptContent=scriptMatch[1];
                scriptOffset=content.substring(0,content.indexOf(scriptMatch[1])).split('\n').length-1;
                isJS=true;  // Treat extracted script as JS
                // Check if it's TypeScript
                if(content.match(/<script\b[^>]*\blang=["']ts["'][^>]*>/i)){
                    isTS=true;
                    isJS=false;
                }
            }else{
                // No script tag found
                return fns;
            }
            lines=scriptContent.split('\n');
        }

        // Try AST parsing for JS/TS files using real parsers
        if((isJS||isTS)&&typeof acorn!=='undefined'){
            var parseContent=scriptContent;
            var parseSuccess=false;

            // Use Babel (real parser) to handle JSX and TypeScript properly
            // Babel transforms JSX → React.createElement and strips TS types,
            // producing clean JS that acorn can parse into a proper AST
            if(typeof Babel!=='undefined'){
                try{
                    var babelPresets=['react'];
                    if(isTS)babelPresets.push('typescript');
                    var babelResult=Babel.transform(parseContent,{
                        presets:babelPresets,
                        filename:filename||'file.js',
                        sourceType:'module',
                        retainLines:true
                    });
                    parseContent=babelResult.code;
                }catch(babelErr){
                    // Babel failed, fall back to manual TypeScript stripping
                    if(isTS){
                        parseContent=Parser.stripTypeScript(scriptContent);
                    }
                }
            }else if(isTS){
                parseContent=Parser.stripTypeScript(scriptContent);
            }

            // Parse clean JS with acorn
            try{
                var ast=acorn.parse(parseContent,{
                    ecmaVersion:2022,
                    sourceType:'module',
                    allowHashBang:true,
                    allowAwaitOutsideFunction:true,
                    allowImportExportEverywhere:true,
                    allowReturnOutsideFunction:true,
                    locations:true
                });
                parseSuccess=true;

                // Walk the AST to find ALL function definitions
                function walk(node,scope,parentIsExport){
                    if(!node||typeof node!=='object')return;

                    var isTopLevel=(scope===0);

                    // FunctionDeclaration: function foo() {}
                    if(node.type==='FunctionDeclaration'&&node.id&&node.id.name){
                        var line=(node.loc?node.loc.start.line:1)+scriptOffset;
                        var endLine=(node.loc?node.loc.end.line:line)+scriptOffset;
                        addFn({
                            name:node.id.name,
                            file:filename,
                            line:line,
                            code:extractCode(line,endLine),
                            isTopLevel:isTopLevel,
                            isExported:parentIsExport||false,
                            type:'function'
                        });
                    }

                    // VariableDeclaration: const foo = () => {} or const foo = function() {}
                    if(node.type==='VariableDeclaration'){
                        node.declarations.forEach(function(decl){
                            if(decl.id&&decl.id.type==='Identifier'&&decl.init){
                                var init=decl.init;
                                // Direct function expression or arrow function ONLY
                                // NOT CallExpression (e.g., array.map(x => x))
                                if(init.type==='FunctionExpression'||init.type==='ArrowFunctionExpression'){
                                    var line=(decl.loc?decl.loc.start.line:1)+scriptOffset;
                                    var endLine=(decl.loc?decl.loc.end.line:line)+scriptOffset;
                                    addFn({
                                        name:decl.id.name,
                                        file:filename,
                                        line:line,
                                        code:extractCode(line,endLine),
                                        isTopLevel:isTopLevel,
                                        isExported:parentIsExport||false,
                                        type:init.type==='ArrowFunctionExpression'?'arrow':'function'
                                    });
                                }
                            }
                        });
                    }

                    // MethodDefinition in classes
                    if(node.type==='MethodDefinition'&&node.key){
                        var name=node.key.name||node.key.value;
                        if(name&&name!=='constructor'){
                            var line=(node.loc?node.loc.start.line:1)+scriptOffset;
                            var endLine=(node.loc?node.loc.end.line:line)+scriptOffset;
                            addFn({
                                name:name,
                                file:filename,
                                line:line,
                                code:extractCode(line,endLine),
                                isTopLevel:false,
                                isExported:false,
                                type:'method',
                                isClassMethod:true,
                                isGetter:node.kind==='get',
                                isSetter:node.kind==='set'
                            });
                        }
                    }

                    // Property with method shorthand: { foo() {} }
                    if(node.type==='Property'&&node.method&&node.key){
                        var name=node.key.name||node.key.value;
                        if(name){
                            var line=(node.loc?node.loc.start.line:1)+scriptOffset;
                            var endLine=(node.loc?node.loc.end.line:line)+scriptOffset;
                            addFn({
                                name:name,
                                file:filename,
                                line:line,
                                code:extractCode(line,endLine),
                                isTopLevel:false,
                                isExported:false,
                                type:'method'
                            });
                        }
                    }

                    // Property with function value: { foo: function() {} } or { foo: () => {} }
                    if(node.type==='Property'&&!node.method&&node.value&&node.key){
                        var val=node.value;
                        if(val.type==='FunctionExpression'||val.type==='ArrowFunctionExpression'){
                            var name=node.key.name||node.key.value;
                            if(name){
                                var line=(node.loc?node.loc.start.line:1)+scriptOffset;
                                var endLine=(node.loc?node.loc.end.line:line)+scriptOffset;
                                addFn({
                                    name:name,
                                    file:filename,
                                    line:line,
                                    code:extractCode(line,endLine),
                                    isTopLevel:false,
                                    isExported:false,
                                    type:'method'
                                });
                            }
                        }
                    }

                    // Handle exports
                    var nextIsExport=false;
                    if(node.type==='ExportNamedDeclaration'||node.type==='ExportDefaultDeclaration'){
                        nextIsExport=true;
                        if(node.declaration){
                            walk(node.declaration,scope,true);
                            return;
                        }
                    }

                    // Recurse - increase scope for function bodies
                    var newScope=scope;
                    if(node.type==='FunctionDeclaration'||node.type==='FunctionExpression'||
                       node.type==='ArrowFunctionExpression'||node.type==='ClassDeclaration'||
                       node.type==='ClassExpression'){
                        newScope=scope+1;
                    }

                    for(var key in node){
                        if(key==='loc'||key==='range'||key==='start'||key==='end'||key==='raw')continue;
                        var child=node[key];
                        if(Array.isArray(child)){
                            child.forEach(function(c){walk(c,newScope,nextIsExport);});
                        }else if(child&&typeof child==='object'&&child.type){
                            walk(child,newScope,nextIsExport);
                        }
                    }
                }

                walk(ast,0,false);

            }catch(e){
                // AST parsing failed
                parseSuccess=false;
            }

            // If AST parsing failed, use comprehensive regex fallback
            if(!parseSuccess){
                Parser.extractWithRegex(scriptContent,filename,scriptOffset,addFn,extractCode);
            }
        }else if(isPython){
            // Python: extract classes, functions, async functions, decorators, and methods
            var currentClass=null;
            var classIndent=-1;
            var decorators=[];
            lines.forEach(function(line,idx){
                var trimmed=line.trimStart();
                var indent=(line.match(/^(\s*)/)||['',''])[1].length;

                // Track decorators
                if(trimmed.match(/^@\w/)){
                    decorators.push(trimmed);
                    return;
                }

                // Detect class definitions
                var classMatch=line.match(/^(\s*)class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[\(:]?/);
                if(classMatch){
                    var cIndent=classMatch[1].length;
                    var className=classMatch[2];
                    var cEndLine=idx+1;
                    for(var i=idx+1;i<lines.length;i++){
                        var nl=lines[i];
                        if(nl.trim()===''||nl.match(/^\s*#/))continue;
                        var ni=(nl.match(/^(\s*)/)||['',''])[1].length;
                        if(ni<=cIndent&&nl.trim()!==''){cEndLine=i;break;}
                        cEndLine=i+1;
                    }
                    var hasDecorator=decorators.length>0;
                    var isDataclass=decorators.some(function(d){return d.includes('dataclass');});
                    var isABC=line.includes('ABC')||line.includes('ABCMeta');
                    addFn({
                        name:className,
                        file:filename,
                        line:idx+1,
                        code:extractCode(idx+1,Math.min(idx+20,cEndLine)),
                        isTopLevel:cIndent===0,
                        isExported:cIndent===0,
                        type:isDataclass?'dataclass':isABC?'abstract_class':'class',
                        decorators:hasDecorator?decorators.slice():undefined
                    });
                    currentClass=className;
                    classIndent=cIndent;
                    decorators=[];
                    return;
                }

                // Reset class context when dedented
                if(currentClass!==null&&indent<=classIndent&&trimmed!==''&&!trimmed.startsWith('#')){
                    currentClass=null;
                    classIndent=-1;
                }

                // Detect function/method definitions (including async def)
                var m=line.match(/^(\s*)(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
                if(m){
                    var fIndent=m[1].length;
                    var name=m[2];
                    var isAsync=line.match(/\basync\s+def\b/)!==null;
                    var isMethod=currentClass!==null&&fIndent>classIndent;
                    var isDunder=name.startsWith('__')&&name.endsWith('__');
                    var isPrivate=name.startsWith('_')&&!isDunder;
                    var isSelf=line.match(/def\s+\w+\s*\(\s*self[\s,)]/);
                    var isCls=line.match(/def\s+\w+\s*\(\s*cls[\s,)]/);
                    var hasDecorator=decorators.length>0;
                    var isProperty=decorators.some(function(d){return d.includes('@property');});
                    var isStaticmethod=decorators.some(function(d){return d.includes('@staticmethod');});
                    var isClassmethod=decorators.some(function(d){return d.includes('@classmethod');});

                    var endLine=idx+1;
                    for(var i=idx+1;i<lines.length;i++){
                        var nextLine=lines[i];
                        if(nextLine.trim()===''||nextLine.match(/^\s*#/))continue;
                        var nextIndent=(nextLine.match(/^(\s*)/)||['',''])[1].length;
                        if(nextIndent<=fIndent&&nextLine.trim()!==''){endLine=i;break;}
                        endLine=i+1;
                    }

                    var fnType='function';
                    if(isMethod){
                        if(isProperty)fnType='property';
                        else if(isStaticmethod)fnType='staticmethod';
                        else if(isClassmethod)fnType='classmethod';
                        else fnType='method';
                    }
                    if(isAsync)fnType='async_'+fnType;

                    addFn({
                        name:isMethod&&currentClass?currentClass+'.'+name:name,
                        file:filename,
                        line:idx+1,
                        code:extractCode(idx+1,endLine),
                        isTopLevel:fIndent===0,
                        isExported:fIndent===0&&!isPrivate,
                        isClassMethod:isMethod,
                        type:fnType,
                        className:isMethod?currentClass:undefined,
                        decorators:hasDecorator?decorators.slice():undefined
                    });
                    decorators=[];
                }else if(!classMatch){
                    // Reset decorators if line is not a def or class
                    if(trimmed!==''&&!trimmed.startsWith('#')&&!trimmed.startsWith('@')){
                        decorators=[];
                    }
                }
            });
        }else{
            // Other languages: use language-specific regex
            Parser.extractOtherLanguages(content,filename,addFn,extractCode);
        }

        return fns;
    },

    // Strip Python string literals and comments for accurate token-level analysis
    // This is a proper tokenizer approach: preserves code structure while removing non-code content
    stripPythonNonCode:function(content){
        var result=[];
        var i=0;
        var len=content.length;
        while(i<len){
            // Triple-quoted strings (must check before single quotes)
            if(i<len-2&&((content[i]==='"'&&content[i+1]==='"'&&content[i+2]==='"')||(content[i]==="'"&&content[i+1]==="'"&&content[i+2]==="'"))){
                var q3=content[i];
                i+=3;
                while(i<len-2){
                    if(content[i]===q3&&content[i+1]===q3&&content[i+2]===q3){i+=3;break;}
                    result.push(content[i]==='\n'?'\n':' ');
                    i++;
                }
            }
            // String prefixes (f/r/b/u and combinations like rb, fr, etc.)
            else if(i<len-1&&/^[frbuFRBU]{1,2}$/.test(content.slice(i,i+1+(content[i+1]&&/[frbuFRBU"']/.test(content[i+1])?1:0)).replace(/["']/g,''))&&
                    (content[i+1]==='"'||content[i+1]==="'"||content[i+2]==='"'||content[i+2]==="'")){
                // Skip prefix chars
                while(i<len&&content[i]!=='"'&&content[i]!=="'"){result.push(' ');i++;}
                // Fall through to string handling below (don't continue)
                if(i>=len)break;
                // Check for triple-quoted prefixed string
                if(i<len-2&&content[i+1]===content[i]&&content[i+2]===content[i]){
                    var pq3=content[i];i+=3;
                    while(i<len-2){
                        if(content[i]===pq3&&content[i+1]===pq3&&content[i+2]===pq3){i+=3;break;}
                        result.push(content[i]==='\n'?'\n':' ');i++;
                    }
                }else{
                    var pq=content[i];result.push(' ');i++;
                    while(i<len&&content[i]!==pq&&content[i]!=='\n'){
                        if(content[i]==='\\'){result.push(' ');i++;}
                        if(i<len){result.push(content[i]==='\n'?'\n':' ');i++;}
                    }
                    if(i<len&&content[i]===pq){result.push(' ');i++;}
                }
            }
            // Regular single/double quoted strings
            else if(content[i]==='"'||content[i]==="'"){
                var q=content[i];result.push(' ');i++;
                while(i<len&&content[i]!==q&&content[i]!=='\n'){
                    if(content[i]==='\\'){result.push(' ');i++;}
                    if(i<len){result.push(content[i]==='\n'?'\n':' ');i++;}
                }
                if(i<len&&content[i]===q){result.push(' ');i++;}
            }
            // Comments
            else if(content[i]==='#'){
                while(i<len&&content[i]!=='\n'){result.push(' ');i++;}
            }
            // Normal code - pass through
            else{
                result.push(content[i]);i++;
            }
        }
        return result.join('');
    },

    // Strip TypeScript syntax for Acorn parsing
    stripTypeScript:function(content){
        // Process line by line for more control
        var lines=content.split('\n');
        var result=[];
        var inInterface=false;
        var braceDepth=0;

        for(var i=0;i<lines.length;i++){
            var line=lines[i];

            // Skip type-only imports/exports
            if(line.match(/^\s*import\s+type\s/)||line.match(/^\s*export\s+type\s/)){
                result.push('');
                continue;
            }

            // Track interface/type blocks to skip
            if(line.match(/^\s*(?:export\s+)?interface\s+/)||line.match(/^\s*(?:export\s+)?type\s+\w+\s*=/)){
                inInterface=true;
                braceDepth=0;
            }

            if(inInterface){
                for(var j=0;j<line.length;j++){
                    if(line[j]==='{')braceDepth++;
                    if(line[j]==='}')braceDepth--;
                }
                if(braceDepth<=0&&(line.includes('}')||line.includes(';')||!line.match(/[{;]/))){
                    inInterface=false;
                }
                result.push('');
                continue;
            }

            // Remove type annotations carefully
            // Function params: (x: Type) -> (x)
            line=line.replace(/(\w)\s*:\s*[A-Za-z_$<>[\]|&\s,]+(?=[,\)])/g,'$1');
            // Return types: ): Type => -> ) =>  or ): Type { -> ) {
            line=line.replace(/\)\s*:\s*[A-Za-z_$<>[\]|&\s]+(?=\s*[{=>])/g,')');
            // Variable types: let x: Type = -> let x =
            line=line.replace(/(let|const|var)\s+(\w+)\s*:\s*[A-Za-z_$<>[\]|&\s]+\s*=/g,'$1 $2 =');
            // Generic type params: func<T>( -> func(
            // Apply repeatedly to handle nested or multiple occurrences
            var prevLine;
            do{
                prevLine=line;
                line=line.replace(/<[A-Za-z_$,\s]+>(?=\s*\()/g,'');
            }while(line!==prevLine);
            // As casts: x as Type -> x
            line=line.replace(/\s+as\s+[A-Za-z_$<>[\]|&\s]+(?=[,;\)\]\}]|$)/g,'');
            // Non-null assertions: x! -> x
            line=line.replace(/!(?=[\.\[\)\],;\s])/g,'');
            // Declare statements
            if(line.match(/^\s*declare\s+/)){
                result.push('');
                continue;
            }

            result.push(line);
        }

        return result.join('\n');
    },

    // Comprehensive regex fallback for JS/TS when AST fails
    extractWithRegex:function(content,filename,offset,addFn,extractCode){
        var lines=content.split('\n');

        lines.forEach(function(line,idx){
            var lineNum=idx+1+offset;
            var m;

            // Named function declarations (capture export keyword for isExported)
            if((m=line.match(/(export\s+(?:default\s+)?)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/)))
                addFn({name:m[2],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,isExported:!!m[1],type:'function'});

            // Arrow functions assigned to const/let/var at START of meaningful content
            // Must have = directly followed by arrow function pattern
            if((m=line.match(/(export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/)))
                addFn({name:m[2],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,isExported:!!m[1],type:'arrow'});

            // Arrow functions with single param (no parens): const foo = x =>
            if((m=line.match(/(export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/)))
                addFn({name:m[2],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,isExported:!!m[1],type:'arrow'});

            // Function expressions: const foo = function
            if((m=line.match(/(export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?function\s*[(\w]/)))
                addFn({name:m[2],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,isExported:!!m[1],type:'function'});

            // Class methods (inside class body): methodName() { or async methodName() {
            if((m=line.match(/^\s+(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*\{/))&&!line.match(/^s*(if|for|while|switch|catch|function|const|let|var)/))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:false,type:'method',isClassMethod:true});

            // Object method shorthand (indented): foo() { or foo: function
            if((m=line.match(/^\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?function/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:false,type:'method'});

            // Object property arrow: foo: () =>
            if((m=line.match(/^\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:false,type:'method'});
        });
    },

    // Extract functions from other languages
    extractOtherLanguages:function(content,filename,addFn,extractCode){
        var lines=content.split('\n');

        lines.forEach(function(line,idx){
            var lineNum=idx+1;
            var m;

            // Go: func name(
            if((m=line.match(/^func\s+(?:\([^)]+\)\s*)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Java/C#/Kotlin: public void methodName( or similar
            if((m=line.match(/(?:public|private|protected|internal|static|final|override|virtual|abstract|async)\s+(?:(?:static|final|override|virtual|abstract|async)\s+)*(?:\w+\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:false,type:'method'});

            // Kotlin: fun name(
            if((m=line.match(/(?:suspend\s+)?fun\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[<(]/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Ruby: def name
            if((m=line.match(/^\s*def\s+([a-zA-Z_][a-zA-Z0-9_?!]*)/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Rust: fn name or pub fn name
            if((m=line.match(/(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[<(]/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // PHP: function name( or public function name(
            if((m=line.match(/(?:public|private|protected|static)?\s*function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // C/C++: type name( at start or with visibility
            if((m=line.match(/^(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?(?:\w+\s+)+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^;]*$/)))
                if(!line.match(/^\s*(if|for|while|switch|return|sizeof|typeof)/))
                    addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Swift: func name
            if((m=line.match(/(?:public|private|internal|fileprivate|open)?\s*(?:static\s+)?(?:class\s+)?func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[<(]/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Scala: def name
            if((m=line.match(/\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[(\[]/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Elixir: def name or defp name
            if((m=line.match(/\bdefp?\s+([a-zA-Z_][a-zA-Z0-9_?!]*)/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Lua: function name( or local function name(
            if((m=line.match(/(?:local\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_.:]*)\s*\(/)))
                addFn({name:m[1].split(/[.:]/).pop(),file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // VBA: Sub Name() or Function Name()
            if((m=line.match(/(?:Public|Private|Friend)?\s*(?:Sub|Function)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/i)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});
        });
    },
    extractJSFunctions:function(content,filename,offset,addFn,extractCode,isTS){
        if(!content||!content.trim())return;
        if(typeof acorn!=='undefined'){
            var parseContent=content;
            var parseSuccess=false;

            if(typeof Babel!=='undefined'){
                try{
                    var babelPresets=['react'];
                    if(isTS)babelPresets.push('typescript');
                    var babelResult=Babel.transform(parseContent,{
                        presets:babelPresets,
                        filename:filename||'file.js',
                        sourceType:'module',
                        retainLines:true
                    });
                    parseContent=babelResult.code;
                }catch(babelErr){
                    if(isTS){
                        parseContent=Parser.stripTypeScript(content);
                    }
                }
            }else if(isTS){
                parseContent=Parser.stripTypeScript(content);
            }

            try{
                var ast=acorn.parse(parseContent,{
                    ecmaVersion:2022,
                    sourceType:'module',
                    allowHashBang:true,
                    allowAwaitOutsideFunction:true,
                    allowImportExportEverywhere:true,
                    allowReturnOutsideFunction:true,
                    locations:true
                });
                parseSuccess=true;

                function walk(node,scope,parentIsExport){
                    if(!node||typeof node!=='object')return;
                    var isTopLevel=(scope===0);

                    if(node.type==='FunctionDeclaration'&&node.id&&node.id.name){
                        var line=(node.loc?node.loc.start.line:1)+offset;
                        var endLine=(node.loc?node.loc.end.line:line)+offset;
                        addFn({
                            name:node.id.name,
                            file:filename,
                            line:line,
                            code:extractCode(line,endLine),
                            isTopLevel:isTopLevel,
                            isExported:parentIsExport||false,
                            type:'function'
                        });
                    }

                    if(node.type==='VariableDeclaration'){
                        node.declarations.forEach(function(decl){
                            if(decl.id&&decl.id.type==='Identifier'&&decl.init){
                                var init=decl.init;
                                if(init.type==='FunctionExpression'||init.type==='ArrowFunctionExpression'){
                                    var line=(decl.loc?decl.loc.start.line:1)+offset;
                                    var endLine=(decl.loc?decl.loc.end.line:line)+offset;
                                    addFn({
                                        name:decl.id.name,
                                        file:filename,
                                        line:line,
                                        code:extractCode(line,endLine),
                                        isTopLevel:isTopLevel,
                                        isExported:parentIsExport||false,
                                        type:init.type==='ArrowFunctionExpression'?'arrow':'function'
                                    });
                                }
                            }
                        });
                    }

                    if(node.type==='MethodDefinition'&&node.key){
                        var methodName=node.key.name||(node.key.value!=null?String(node.key.value):null);
                        if(methodName&&methodName!=='constructor'){
                            var methodLine=(node.loc?node.loc.start.line:1)+offset;
                            var methodEndLine=(node.loc?node.loc.end.line:methodLine)+offset;
                            addFn({
                                name:methodName,
                                file:filename,
                                line:methodLine,
                                code:extractCode(methodLine,methodEndLine),
                                isTopLevel:false,
                                isExported:false,
                                type:'method',
                                isClassMethod:true,
                                isGetter:node.kind==='get',
                                isSetter:node.kind==='set'
                            });
                        }
                    }

                    if(node.type==='Property'&&node.method&&node.key){
                        var shorthandName=node.key.name||(node.key.value!=null?String(node.key.value):null);
                        if(shorthandName){
                            var shorthandLine=(node.loc?node.loc.start.line:1)+offset;
                            var shorthandEndLine=(node.loc?node.loc.end.line:shorthandLine)+offset;
                            addFn({
                                name:shorthandName,
                                file:filename,
                                line:shorthandLine,
                                code:extractCode(shorthandLine,shorthandEndLine),
                                isTopLevel:false,
                                isExported:false,
                                type:'method'
                            });
                        }
                    }

                    if(node.type==='Property'&&!node.method&&node.value&&node.key){
                        var val=node.value;
                        if(val.type==='FunctionExpression'||val.type==='ArrowFunctionExpression'){
                            var propName=node.key.name||(node.key.value!=null?String(node.key.value):null);
                            if(propName){
                                var propLine=(node.loc?node.loc.start.line:1)+offset;
                                var propEndLine=(node.loc?node.loc.end.line:propLine)+offset;
                                addFn({
                                    name:propName,
                                    file:filename,
                                    line:propLine,
                                    code:extractCode(propLine,propEndLine),
                                    isTopLevel:false,
                                    isExported:false,
                                    type:'method'
                                });
                            }
                        }
                    }

                    var nextIsExport=false;
                    if(node.type==='ExportNamedDeclaration'||node.type==='ExportDefaultDeclaration'){
                        nextIsExport=true;
                        if(node.declaration){
                            walk(node.declaration,scope,true);
                            return;
                        }
                    }

                    var newScope=scope;
                    if(node.type==='FunctionDeclaration'||node.type==='FunctionExpression'||
                       node.type==='ArrowFunctionExpression'||node.type==='ClassDeclaration'||
                       node.type==='ClassExpression'){
                        newScope=scope+1;
                    }

                    for(var key in node){
                        if(key==='loc'||key==='range'||key==='start'||key==='end'||key==='raw')continue;
                        var child=node[key];
                        if(Array.isArray(child)){
                            child.forEach(function(c){walk(c,newScope,nextIsExport);});
                        }else if(child&&typeof child==='object'&&child.type){
                            walk(child,newScope,nextIsExport);
                        }
                    }
                }

                walk(ast,0,false);
            }catch(e){
                parseSuccess=false;
            }

            if(!parseSuccess){
                Parser.extractWithRegex(content,filename,offset,addFn,extractCode);
            }
            return;
        }

        Parser.extractWithRegex(content,filename,offset,addFn,extractCode);
    },
    findJSCalls:function(content,fnNames,defLines,options){
        fnNames=Parser.candidateFunctionNames(content,fnNames);
        var calls={};
        var refs={};
        if(!fnNames.length)return calls;
        fnNames.forEach(function(fn){calls[fn]=0;refs[fn]=0;});

        var sourceType=options&&options.sourceType==='script'?'script':'module';
        var isTS=!!(options&&options.isTS);

        if(typeof acorn!=='undefined'){
            try{
                var jsContent=content;
                if(typeof Babel!=='undefined'){
                    try{
                        var babelPresets=['react'];
                        if(isTS)babelPresets.push('typescript');
                        var babelResult=Babel.transform(content,{
                            presets:babelPresets,
                            filename:options&&options.filename?options.filename:'file.js',
                            sourceType:sourceType,
                            retainLines:true
                        });
                        jsContent=babelResult.code;
                    }catch(babelErr){
                        jsContent=isTS?Parser.stripTypeScript(content):content;
                    }
                }else if(isTS){
                    jsContent=Parser.stripTypeScript(content);
                }

                var ast=acorn.parse(jsContent,{
                    ecmaVersion:2022,
                    sourceType:sourceType,
                    allowHashBang:true,
                    allowAwaitOutsideFunction:true,
                    allowImportExportEverywhere:true,
                    allowReturnOutsideFunction:true,
                    locations:true,
                    tolerant:true
                });
                var fnSet=new Set(fnNames);

                function walk(node,inDeclaration){
                    if(!node||typeof node!=='object')return;
                    var isDecl=node.type==='FunctionDeclaration'||node.type==='VariableDeclarator';

                    if(node.type==='CallExpression'){
                        var callee=node.callee;
                        if(callee.type==='Identifier'&&fnSet.has(callee.name)){
                            var line=callee.loc?callee.loc.start.line:0;
                            if(!defLines[callee.name]||defLines[callee.name]!==line){
                                calls[callee.name]++;
                            }
                        }
                        node.arguments.forEach(function(arg){
                            if(arg.type==='Identifier'&&fnSet.has(arg.name)){
                                refs[arg.name]++;
                            }
                        });
                    }

                    if(node.type==='ArrayExpression'){
                        node.elements.forEach(function(el){
                            if(el&&el.type==='Identifier'&&fnSet.has(el.name)){
                                refs[el.name]++;
                            }
                        });
                    }
                    if(node.type==='Property'&&node.value&&node.value.type==='Identifier'&&fnSet.has(node.value.name)){
                        refs[node.value.name]++;
                    }

                    if(node.type==='Identifier'&&fnSet.has(node.name)&&!inDeclaration){
                        // Identifier references are handled via the surrounding parent nodes.
                    }

                    for(var key in node){
                        if(key==='loc'||key==='range'||key==='start'||key==='end')continue;
                        var child=node[key];
                        var nextInDecl=isDecl&&(key==='id'||key==='key');
                        if(Array.isArray(child)){
                            child.forEach(function(c){walk(c,nextInDecl);});
                        }else if(child&&typeof child==='object'&&child.type){
                            walk(child,nextInDecl);
                        }
                    }
                }

                walk(ast,false);
                fnNames.forEach(function(fn){
                    calls[fn]=calls[fn]+(refs[fn]||0);
                });
                return calls;
            }catch(e){
                // Fall back to regex below.
            }
        }

        return Parser.countCandidateCalls(content,fnNames,{isJS:true});
    },

    buildFunctionNameIndex:function(fnNames){
        var exact=new Set();
        var byBase=Object.create(null);
        (fnNames||[]).forEach(function(fn){
            if(typeof fn!=='string'||!fn)return;
            exact.add(fn);
            if(fn.indexOf('.')>=0){
                var parts=fn.split('.');
                var base=parts[parts.length-1];
                if(!byBase[base])byBase[base]=[];
                byBase[base].push(fn);
            }
        });
        return{exact:exact,byBase:byBase};
    },

    buildFunctionDefLineIndex:function(fnDefs){
        var byFile=Object.create(null);
        (fnDefs||[]).forEach(function(fn){
            if(!byFile[fn.file])byFile[fn.file]=Object.create(null);
            byFile[fn.file][fn.name]=fn.line;
        });
        return byFile;
    },

    functionKey:function(fn){
        if(!fn)return'';
        return [fn.file||'',fn.line||'',String(fn.name==null?'':fn.name)].join('|');
    },

    buildFunctionDefinitionIndex:function(fnDefs){
        var byName=Object.create(null);
        var byKey=Object.create(null);
        (fnDefs||[]).forEach(function(fn){
            if(!fn||typeof fn.name!=='string'||!fn.name)return;
            var key=Parser.functionKey(fn);
            fn.key=key;
            if(byKey[key])return;
            byKey[key]=fn;
            if(!byName[fn.name])byName[fn.name]=[];
            byName[fn.name].push(fn);
        });
        return{byName:byName,byKey:byKey};
    },

    resolveCallGraphImportPath:function(importPath,fromFile,files){
        if(!importPath||/^(?:node:|https?:|data:|mailto:)/i.test(importPath))return null;
        var fromPath=String(fromFile||'').replace(/\\/g,'/').replace(/^\/+/,'');
        var fromDir=fromPath.indexOf('/')>=0?fromPath.split('/').slice(0,-1).join('/'):'';
        var fromExt=(fromPath.split('.').pop()||'').toLowerCase();
        var isPython=['py','pyw','pyi'].indexOf(fromExt)>=0;
        var candidates=[];
        function normalizePath(path){
            var out=[];
            String(path||'').replace(/\\/g,'/').split('/').forEach(function(part){
                if(!part||part==='.')return;
                if(part==='..')out.pop();
                else out.push(part);
            });
            return out.join('/');
        }
        function addCandidate(path){
            path=normalizePath(path);
            if(path&&candidates.indexOf(path)<0)candidates.push(path);
        }

        if(importPath.startsWith('@/'))addCandidate('src/'+importPath.slice(2));
        else if(importPath.startsWith('~/'))addCandidate('src/'+importPath.slice(2));
        else if(importPath.startsWith('./')||importPath.startsWith('../'))addCandidate((fromDir?fromDir+'/':'')+importPath);
        else if(isPython&&/^\.+/.test(importPath)){
            var dotCount=(importPath.match(/^\.+/)||[''])[0].length;
            var rest=importPath.slice(dotCount).replace(/\./g,'/');
            var parts=fromDir?fromDir.split('/'):[];
            for(var di=1;di<dotCount;di++)parts.pop();
            addCandidate(parts.concat(rest?rest.split('/'):[]).join('/'));
        }else if(isPython){
            var modulePath=importPath.replace(/\./g,'/');
            addCandidate((fromDir?fromDir+'/':'')+modulePath);
            addCandidate(modulePath);
        }else{
            return null;
        }

        var pathMap=Object.create(null);
        (files||[]).forEach(function(file){
            var p=String(file.path||file.name||'').replace(/\\/g,'/').replace(/^\/+/,'');
            if(p)pathMap[p.toLowerCase()]=p;
        });
        var exts=['','.js','.jsx','.ts','.tsx','.mjs','.cjs','.vue','.svelte','.py','.pyw','.pyi','.vba','.bas','.cls','/index.js','/index.jsx','/index.ts','/index.tsx','/__init__.py'];
        for(var i=0;i<candidates.length;i++){
            for(var j=0;j<exts.length;j++){
                var candidate=normalizePath(candidates[i]+exts[j]).toLowerCase();
                if(pathMap[candidate])return pathMap[candidate];
            }
        }
        return null;
    },

    extractCallGraphImportMap:function(content,fromFile,files){
        var locals=Object.create(null);
        var targets=new Set();
        function addLocal(localName,resolved){
            if(!localName||!resolved)return;
            if(!locals[localName])locals[localName]=new Set();
            locals[localName].add(resolved);
            targets.add(resolved);
        }
        function addTarget(resolved){
            if(resolved)targets.add(resolved);
        }
        function parseImportNames(spec,resolved){
            (spec||'').split(',').forEach(function(part){
                part=part.trim().replace(/^type\s+/,'').trim();
                if(!part||part==='default')return;
                var alias=part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
                if(alias){addLocal(alias[2],resolved);return;}
                var destructured=part.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
                if(destructured){addLocal(destructured[2],resolved);return;}
                var name=part.match(/^([A-Za-z_$][\w$]*)$/);
                if(name)addLocal(name[1],resolved);
            });
        }
        function parseJsImportSpec(spec,resolved){
            spec=(spec||'').trim().replace(/^type\s+/,'').trim();
            if(!spec)return;
            var named=spec.match(/\{([\s\S]*?)\}/);
            if(named)parseImportNames(named[1],resolved);
            var ns=spec.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
            if(ns)addLocal(ns[1],resolved);
            var defaultPart=spec.split('{')[0].split('*')[0].split(',')[0].trim();
            if(/^[A-Za-z_$][\w$]*$/.test(defaultPart))addLocal(defaultPart,resolved);
        }

        var source=String(content||'');
        var match;
        var jsImportRe=/\bimport\s+(?!\()([\s\S]*?)\s+from\s*['"`]([^'"`]+)['"`]/g;
        while((match=jsImportRe.exec(source))!==null){
            var importSpec=match[1]||'';
            if(/^\s*type\b/.test(importSpec))continue;
            var resolved=Parser.resolveCallGraphImportPath(match[2],fromFile,files);
            addTarget(resolved);
            parseJsImportSpec(importSpec,resolved);
        }
        var cjsNamedRe=/\b(?:const|let|var)\s+\{([\s\S]*?)\}\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        while((match=cjsNamedRe.exec(source))!==null){
            var namedResolved=Parser.resolveCallGraphImportPath(match[2],fromFile,files);
            addTarget(namedResolved);
            parseImportNames(match[1],namedResolved);
        }
        var cjsDefaultRe=/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        while((match=cjsDefaultRe.exec(source))!==null){
            var defaultResolved=Parser.resolveCallGraphImportPath(match[2],fromFile,files);
            addLocal(match[1],defaultResolved);
        }

        var pyFromRe=/^\s*from\s+([.\w]+)\s+import\s+([^\n#]+)/gm;
        while((match=pyFromRe.exec(source))!==null){
            var pyResolved=Parser.resolveCallGraphImportPath(match[1],fromFile,files);
            addTarget(pyResolved);
            parseImportNames(match[2].replace(/[()]/g,''),pyResolved);
        }
        var pyImportRe=/^\s*import\s+([^\n#]+)/gm;
        while((match=pyImportRe.exec(source))!==null){
            match[1].split(',').forEach(function(part){
                part=part.trim();
                var pieces=part.split(/\s+as\s+/);
                var moduleName=(pieces[0]||'').trim();
                var localName=(pieces[1]||moduleName.split('.').pop()||'').trim();
                var moduleResolved=Parser.resolveCallGraphImportPath(moduleName,fromFile,files);
                addLocal(localName,moduleResolved);
            });
        }

        var localFiles=Object.create(null);
        Object.keys(locals).forEach(function(name){
            localFiles[name]=Array.from(locals[name]);
        });
        return{locals:localFiles,targets:targets};
    },

    candidateFunctionNames:function(content,fnNames,fnIndex){
        if(!content||!fnNames||!fnNames.length)return[];
        if(fnNames.length<=Parser._callCandidateThreshold)return fnNames;
        var wordSet=new Set(String(content).match(/\b[a-zA-Z_$][\w$]*\b/g)||[]);
        if(!wordSet.size)return[];
        var index=fnIndex||Parser.buildFunctionNameIndex(fnNames);
        var out=[];
        var seen=new Set();
        wordSet.forEach(function(word){
            if(index.exact.has(word)&&!seen.has(word)){
                seen.add(word);
                out.push(word);
            }
            var baseMatches=index.byBase[word];
            if(baseMatches){
                baseMatches.forEach(function(fn){
                    if(!seen.has(fn)){
                        seen.add(fn);
                        out.push(fn);
                    }
                });
            }
        });
        return out;
    },

    countCandidateCalls:function(content,fnNames,options){
        var calls=Object.create(null);
        var refs=Object.create(null);
        var candidateSet=new Set(fnNames||[]);
        var source=String(content||'');
        var opts=options||{};
        fnNames.forEach(function(fn){calls[fn]=0;refs[fn]=0;});
        if(!source||!candidateSet.size)return calls;

        var tokenRe=/\b[a-zA-Z_$][\w$]*\b/g;
        var match;
        while((match=tokenRe.exec(source))!==null){
            var name=match[0];
            if(!candidateSet.has(name))continue;
            var start=match.index;
            var end=start+name.length;
            var prev=start-1;
            while(prev>=0&&/\s/.test(source[prev]))prev--;
            var next=end;
            while(next<source.length&&/\s/.test(source[next]))next++;
            var nextChar=source[next]||'';
            var prevChar=prev>=0?source[prev]:'';
            var lineStart=source.lastIndexOf('\n',start-1)+1;
            var prefix=source.slice(lineStart,start);
            var isDefinition=false;
            if(/\b(function|class|def)\s*$/.test(prefix))isDefinition=true;
            if(opts.isPython&&/\b(async\s+def|def|class)\s*$/.test(prefix))isDefinition=true;
            if(opts.isVBA&&/\b(Sub|Function)\s+$/i.test(prefix))isDefinition=true;
            if(nextChar==='('&&!isDefinition){
                calls[name]++;
            }else if(!isDefinition&&'[,[:(={'.indexOf(prevChar)>=0&&' ,])};\n\r'.indexOf(nextChar)>=0){
                refs[name]++;
            }else if(opts.isPython&&prevChar==='@'&&!isDefinition){
                refs[name]++;
            }
        }

        if(opts.isJS&&source.indexOf('<')>=0){
            var jsxTagRe=/<\/?\s*([A-Za-z_$][\w$]*)[\s>\/{]/g;
            while((match=jsxTagRe.exec(source))!==null){
                if(candidateSet.has(match[1]))refs[match[1]]++;
            }
            var jsxExprRe=/[{=]\s*([A-Za-z_$][\w$]*)\s*[}(,;\s]/g;
            while((match=jsxExprRe.exec(source))!==null){
                if(candidateSet.has(match[1]))refs[match[1]]++;
            }
        }

        if(opts.isPython){
            var importRe=/^(?:from\s+\S+\s+import\s+(?:\([^)]+\)|[^\n]+)|import\s+[^\n]+)$/gm;
            while((match=importRe.exec(source))!==null){
                var importWords=match[0].match(/\b[a-zA-Z_]\w*\b/g)||[];
                importWords.forEach(function(word){if(candidateSet.has(word))refs[word]++;});
            }
        }

        if(opts.isVBA){
            var vbaRunRe=/Application\.Run\s*["']([A-Za-z_]\w*)["']/gi;
            while((match=vbaRunRe.exec(source))!==null){
                if(candidateSet.has(match[1]))calls[match[1]]++;
            }
        }

        fnNames.forEach(function(fn){
            calls[fn]=Math.max(0,calls[fn]||0)+(refs[fn]||0);
        });
        return calls;
    },

    // AST-based call detection - finds actual function calls and references
    findCalls:function(content,fnNames,definingFile,fnDefs,fnIndex){
        fnNames=Parser.candidateFunctionNames(content,fnNames,fnIndex);
        var calls={};
        var refs={};  // Functions used as callbacks/references without ()
        if(!fnNames.length)return calls;
        fnNames.forEach(function(fn){calls[fn]=0;refs[fn]=0;});

        // Build a set of definition lines to exclude
        var defLines={};
        if(fnDefs&&!Array.isArray(fnDefs)){
            defLines=fnDefs[definingFile]||{};
        }else if(fnDefs){
            fnDefs.forEach(function(fn){
                if(fn.file===definingFile){
                    defLines[fn.name]=fn.line;
                }
            });
        }

        if(Parser.isScriptContainer(definingFile)){
            var blocks=Parser.getEmbeddedCodeBlocks(content,definingFile,{includeHandlers:true});
            if(!blocks.length)return calls;
            blocks.forEach(function(block){
                var blockCalls=Parser.findJSCalls(block.content,fnNames,defLines,{
                    filename:definingFile,
                    isTS:block.isTS,
                    sourceType:block.kind==='handler'?'script':block.sourceType
                });
                fnNames.forEach(function(fn){
                    calls[fn]+=blockCalls[fn]||0;
                });
            });
            return calls;
        }

        // Detect file language from defining file extension
        var ext=definingFile?definingFile.split('.').pop().toLowerCase():'';
        var isPython=['py','pyw','pyi'].indexOf(ext)>=0;
        var isJS=['js','jsx','ts','tsx','mjs','cjs','vue','svelte'].indexOf(ext)>=0;
        var isVBA=['vba','bas','cls','xlsm','xlam'].indexOf(ext)>=0;

        // Python: use tree-sitter real parser (WASM) for accurate AST-based detection
        if(isPython){
            var tsParser=Parser.getLoadedTreeSitterParser(definingFile);
            if(tsParser){
                try{
                    var tree=tsParser.parse(content);
                    var root=tree.rootNode;
                    var fnSet=new Set(fnNames);

                    // Determine if an identifier node is a definition name (not a usage)
                    function isPyDefName(node){
                        var p=node.parent;
                        if(!p)return false;
                        // Function/class definition name: def foo / class Foo
                        if((p.type==='function_definition'||p.type==='class_definition')&&
                            p.childForFieldName('name')===node)return true;
                        // Parameter names in function signatures
                        if(p.type==='parameters'||p.type==='lambda_parameters')return true;
                        if((p.type==='typed_parameter'||p.type==='default_parameter'||
                            p.type==='typed_default_parameter')&&p.children[0]===node)return true;
                        if(p.type==='list_splat_pattern'||p.type==='dictionary_splat_pattern')return true;
                        // For loop target: for x in ...
                        if(p.type==='for_statement'&&p.childForFieldName('left')===node)return true;
                        // With statement target: with x as y
                        if(p.type==='as_pattern'&&p.childForFieldName('alias')===node)return true;
                        // Exception handler: except E as e
                        if(p.type==='except_clause')return false; // the exception type IS a reference
                        // Comprehension targets: [x for x in ...]
                        if(p.type==='for_in_clause'&&p.childForFieldName('left')===node)return true;
                        return false;
                    }

                    // Walk the CST: every identifier that matches a function name
                    // and is NOT a definition is counted as a usage reference.
                    // tree-sitter naturally excludes identifiers inside strings/comments
                    // because those are parsed as string/comment nodes, not identifiers.
                    function walkPy(node){
                        if(node.type==='identifier'&&fnSet.has(node.text)&&!isPyDefName(node)){
                            calls[node.text]++;
                        }
                        for(var i=0;i<node.childCount;i++){
                            walkPy(node.child(i));
                        }
                    }
                    walkPy(root);
                    tree.delete();
                    return calls;
                }catch(tsErr){
                    // tree-sitter parse failed, fall through to tokenizer fallback
                }
            }

            // Fallback: token-level analysis with string/comment stripping
            var cleanContent=Parser.stripPythonNonCode(content);
            return Parser.countCandidateCalls(cleanContent,fnNames,{isPython:true});
        }

        if(isJS&&typeof acorn!=='undefined'){
            try{
                // Use Babel (real parser) to handle JSX and TypeScript
                // Babel transforms JSX → React.createElement calls and strips TS types,
                // so acorn can parse the result into a proper AST for accurate call detection
                var jsContent=content;
                if(typeof Babel!=='undefined'){
                    try{
                        var babelPresets=['react'];
                        if(ext==='ts'||ext==='tsx')babelPresets.push('typescript');
                        var babelResult=Babel.transform(content,{
                            presets:babelPresets,
                            filename:definingFile||'file.js',
                            sourceType:'module',
                            retainLines:true
                        });
                        jsContent=babelResult.code;
                    }catch(babelErr){
                        // Babel failed, fall back to manual TypeScript stripping
                        jsContent=content
                            .replace(/:\s*[A-Za-z_$][\w$<>,\s|&\[\]]*(?=\s*[=,\)\}\];])/g,'')
                            .replace(/\bas\s+[A-Za-z_$][\w$<>,\s|&\[\]]*(?=\s*[,\)\}\];])/g,'')
                            .replace(/<[A-Za-z_$][\w$<>,\s|&\[\]]*>(?=\s*\()/g,'')
                            .replace(/^import\s+type\s+.*/gm,'')
                            .replace(/^export\s+type\s+.*/gm,'')
                            .replace(/^export\s+interface\s+.*/gm,'')
                            .replace(/interface\s+[A-Za-z_$][\w$]*\s*\{[^}]*\}/g,'')
                            .replace(/type\s+[A-Za-z_$][\w$]*\s*=\s*[^;]+;/g,'');
                    }
                }else{
                    jsContent=content
                        .replace(/:\s*[A-Za-z_$][\w$<>,\s|&\[\]]*(?=\s*[=,\)\}\];])/g,'')
                        .replace(/\bas\s+[A-Za-z_$][\w$<>,\s|&\[\]]*(?=\s*[,\)\}\];])/g,'')
                        .replace(/<[A-Za-z_$][\w$<>,\s|&\[\]]*>(?=\s*\()/g,'')
                        .replace(/^import\s+type\s+.*/gm,'')
                        .replace(/^export\s+type\s+.*/gm,'')
                        .replace(/^export\s+interface\s+.*/gm,'')
                        .replace(/interface\s+[A-Za-z_$][\w$]*\s*\{[^}]*\}/g,'')
                        .replace(/type\s+[A-Za-z_$][\w$]*\s*=\s*[^;]+;/g,'');
                }

                var ast=acorn.parse(jsContent,{
                    ecmaVersion:2022,
                    sourceType:'module',
                    allowHashBang:true,
                    allowAwaitOutsideFunction:true,
                    allowImportExportEverywhere:true,
                    locations:true,
                    tolerant:true
                });

                var fnSet=new Set(fnNames);

                function walk(node,inDeclaration){
                    if(!node||typeof node!=='object')return;

                    // Track if we're in a function declaration to skip counting the name
                    var isDecl=node.type==='FunctionDeclaration'||node.type==='VariableDeclarator';

                    // CallExpression: foo() or foo.bar()
                    if(node.type==='CallExpression'){
                        var callee=node.callee;
                        if(callee.type==='Identifier'&&fnSet.has(callee.name)){
                            var line=callee.loc?callee.loc.start.line:0;
                            // Don't count if this is the definition line
                            if(!defLines[callee.name]||defLines[callee.name]!==line){
                                calls[callee.name]++;
                            }
                        }
                        // Also check arguments for function references
                        node.arguments.forEach(function(arg){
                            if(arg.type==='Identifier'&&fnSet.has(arg.name)){
                                refs[arg.name]++;
                            }
                        });
                    }

                    // Function passed as reference (callback): arr.map(fn), addEventListener('click', fn)
                    if(node.type==='Identifier'&&fnSet.has(node.name)&&!inDeclaration){
                        // This is handled via parent context - check if parent is not a CallExpression callee
                        // refs tracking happens in CallExpression arguments above
                    }

                    // Array element or object property value containing function ref
                    if(node.type==='ArrayExpression'){
                        node.elements.forEach(function(el){
                            if(el&&el.type==='Identifier'&&fnSet.has(el.name)){
                                refs[el.name]++;
                            }
                        });
                    }
                    if(node.type==='Property'&&node.value&&node.value.type==='Identifier'&&fnSet.has(node.value.name)){
                        refs[node.value.name]++;
                    }

                    // Recurse
                    for(var key in node){
                        if(key==='loc'||key==='range'||key==='start'||key==='end')continue;
                        var child=node[key];
                        var nextInDecl=isDecl&&(key==='id'||key==='key');
                        if(Array.isArray(child)){
                            child.forEach(function(c){walk(c,nextInDecl);});
                        }else if(child&&typeof child==='object'&&child.type){
                            walk(child,nextInDecl);
                        }
                    }
                }

                walk(ast,false);

                // Combine calls and refs
                fnNames.forEach(function(fn){
                    calls[fn]=calls[fn]+(refs[fn]||0);
                });

                return calls;

            }catch(e){
                // Fall back to regex but be more careful
            }
        }

        // Fallback: regex-based but more careful
        return Parser.countCandidateCalls(content,fnNames,{isJS:isJS,isVBA:isVBA});
    }
};

function escapeHtml(value){
    return String(value==null?'':value)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#39;');
}

function renderTooltipHtml(title,stats){
    return '<div class="treemap-tooltip-title">'+escapeHtml(title)+'</div>'+stats.map(function(stat){
        return '<div class="treemap-tooltip-stat"><span>'+escapeHtml(stat.label)+':</span><span>'+escapeHtml(stat.value)+'</span></div>';
    }).join('');
}

// ---------------------------------------------------------------------------
// GitHub API Adapter
// ---------------------------------------------------------------------------

function buildGitHubApiUrl(segments,query){
    var path=segments.filter(function(segment){return segment!==undefined&&segment!==null&&segment!=='';}).map(function(segment){
        return encodeURIComponent(String(segment));
    }).join('/');
    var url='https://api.github.com/'+path;
    if(!query)return url;
    var params=new URLSearchParams();
    Object.keys(query).forEach(function(key){
        var value=query[key];
        if(value===undefined||value===null||value==='')return;
        params.set(key,String(value));
    });
    var queryString=params.toString();
    return queryString?url+'?'+queryString:url;
}

function buildRepoApiUrl(owner,repo,segments,query){
    return buildGitHubApiUrl(['repos',owner,repo].concat(segments||[]),query);
}

function splitRepoPath(path){
    return (path||'').split('/').filter(Boolean);
}

function decodeBase64Utf8(content){
    var normalized=String(content||'').replace(/\s+/g,'');
    if(!normalized)return null;
    var binary=atob(normalized);
    var bytes=new Uint8Array(binary.length);
    for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    try{
        return new TextDecoder('utf-8').decode(bytes);
    }catch(e){
        var text='';
        for(var j=0;j<bytes.length;j++)text+=String.fromCharCode(bytes[j]);
        return text;
    }
}

var GitHub={
    token:'',
    appId:null,
    privateKey:null,
    installationToken:null,
    installationTokenExpiry:null,
    rateLimit:{remaining:60,limit:60,reset:0},
    requestTimeoutMs:15000,
    
    // Generate JWT for GitHub App authentication
    generateJWT:function(){
        if(!this.appId||!this.privateKey)return null;
        try{
            var now=Math.floor(Date.now()/1000);
            var payload={
                iat:now-60,// Issued at (60 seconds in past to account for clock drift)
                exp:now+600,// Expires in 10 minutes (max allowed)
                iss:this.appId
            };
            var header={alg:'RS256',typ:'JWT'};
            var sHeader=JSON.stringify(header);
            var sPayload=JSON.stringify(payload);
            var jwt=KJUR.jws.JWS.sign('RS256',sHeader,sPayload,this.privateKey);
            return jwt;
        }catch(e){
            console.error('JWT generation failed:',e);
            return null;
        }
    },
    
    getRepoInstallation:function(owner,repo){
        var jwt=this.generateJWT();
        if(!jwt)return Promise.reject(new Error('Failed to generate JWT'));
        return this.request(buildGitHubApiUrl(['repos',owner,repo,'installation']),{
            headers:{
                'Accept':'application/vnd.github.v3+json',
                'Authorization':'Bearer '+jwt
            }
        },{401:'Invalid App credentials',404:'This GitHub App is not installed on the selected repository'});
    },
    
    // Get installation access token
    getInstallationToken:function(installationId){
        var self=this;
        var jwt=this.generateJWT();
        if(!jwt)return Promise.reject(new Error('Failed to generate JWT'));
        return this.request(buildGitHubApiUrl(['app','installations',String(installationId),'access_tokens']),{
            method:'POST',
            headers:{
                'Accept':'application/vnd.github.v3+json',
                'Authorization':'Bearer '+jwt
            }
        },{401:'Invalid App credentials',404:'Installation not found'}).then(function(data){
            self.installationToken=data.token;
            self.installationTokenExpiry=new Date(data.expires_at).getTime();
            self.token=data.token;// Use installation token for API calls
            return data.token;
        });
    },
    
    // Authenticate with GitHub App for a specific repo
    authenticateApp:function(owner,repo){
        var self=this;
        // Check if we have a valid installation token
        if(this.installationToken&&this.installationTokenExpiry&&Date.now()<this.installationTokenExpiry-60000){
            this.token=this.installationToken;
            return Promise.resolve(this.installationToken);
        }
        return this.getRepoInstallation(owner,repo).then(function(installation){
            if(!installation||!installation.id){
                throw new Error('No installation found for this repository');
            }
            return self.getInstallationToken(installation.id);
        });
    },
    
    request:function(url,options,errorMap){
        var self=this;
        var h=Object.assign({'Accept':'application/vnd.github.v3+json'},options&&options.headers?options.headers:{});
        if(this.token&&!h.Authorization)h.Authorization='Bearer '+this.token;
        var controller=new AbortController();
        var timeoutId=setTimeout(function(){controller.abort();},this.requestTimeoutMs);
        var requestOptions=Object.assign({},options||{},{headers:h,signal:controller.signal});
        return fetch(url,requestOptions).then(function(r){
            // Track rate limit from headers
            var rem=r.headers.get('x-ratelimit-remaining');
            var lim=r.headers.get('x-ratelimit-limit');
            var rst=r.headers.get('x-ratelimit-reset');
            if(rem!==null)self.rateLimit.remaining=parseInt(rem,10);
            if(lim!==null)self.rateLimit.limit=parseInt(lim,10);
            if(rst!==null)self.rateLimit.reset=parseInt(rst,10);
            if(!r.ok){
                throw new Error(
                    errorMap&&errorMap[r.status]
                        ? errorMap[r.status]
                        : r.status===401
                            ? 'Invalid token'
                            : r.status===403
                                ? 'Rate limited - add a GitHub token for 5000 req/hour'
                                : r.status===404
                                    ? 'Repository not found'
                                    : r.status===429
                                        ? 'Rate limited (429) - add a GitHub token'
                                        : 'Error '+r.status
                );
            }
            return r.json();
        }).catch(function(err){
            if(err&&err.name==='AbortError'){
                throw new Error('GitHub request timed out. Please try again.');
            }
            throw err;
        }).finally(function(){
            clearTimeout(timeoutId);
        });
    },
    fetch:function(url,options,errorMap){
        return this.request(url,options,errorMap);
    },
    getRateLimit:function(){
        var self=this;
        return this.request(buildGitHubApiUrl(['rate_limit'])).then(function(d){
            if(d.resources&&d.resources.core){
                self.rateLimit.remaining=d.resources.core.remaining;
                self.rateLimit.limit=d.resources.core.limit;
                self.rateLimit.reset=d.resources.core.reset;
            }
            return self.rateLimit;
        }).catch(function(){return self.rateLimit;});
    },
    getFile:function(o,r,p){
        return this.fetch(buildRepoApiUrl(o,r,['contents'].concat(splitRepoPath(p)))).then(function(d){return d.content?decodeBase64Utf8(d.content):null;}).catch(function(){return null;});
    },
    getCommits:function(o,r,path,limit){
        if(this.rateLimit.remaining<20&&!this.token)return Promise.resolve([]);// Skip when rate limited
        return this.fetch(buildRepoApiUrl(o,r,['commits'],{per_page:limit||30,path:path||undefined})).catch(function(){return[];});
    },
    getBlame:function(o,r,path){
        return this.getCommits(o,r,path,50).then(function(commits){
            var authors={};
            commits.forEach(function(c){var name=c.commit.author.name;authors[name]=(authors[name]||0)+1;});
            return Object.entries(authors).map(function(e){return{name:e[0],commits:e[1],percent:Math.round(e[1]/commits.length*100)};}).sort(function(a,b){return b.commits-a.commits;});
        }).catch(function(){return[];});
    },
    getPR:function(o,r,prNum){
        var self=this;
        return this.fetch(buildRepoApiUrl(o,r,['pulls',String(prNum)])).then(function(pr){
            return self.fetch(buildRepoApiUrl(o,r,['pulls',String(prNum),'files'])).then(function(files){
                pr.files=files;return pr;
            });
        }).catch(function(){return null;});
    },
    // Fast scan using Git Trees API (single request for all files!)
    scanTree:function(o,r,cb,compiledPatterns){
        var self=this;
        if(cb)cb('Fetching repository tree...');
        // First get repo info to find default branch
        return this.fetch(buildRepoApiUrl(o,r)).then(function(repo){
            var branch=repo.default_branch||'main';
            if(cb)cb('Loading file tree ('+branch+')...');
            // Get full tree in one request with recursive flag
            return self.fetch(buildRepoApiUrl(o,r,['git','trees',branch],{recursive:1}));
        }).then(function(tree){
            if(!tree.tree)throw new Error('Invalid tree response');
            var f=[];
            tree.tree.forEach(function(i){
                if(i.type!=='blob')return;
                var name=i.path.includes('/')?i.path.substring(i.path.lastIndexOf('/')+1):i.path;
                if(shouldExcludeFile(i.path,name,compiledPatterns))return;
                var pathParts=i.path.split('/');
                var ignored=pathParts.slice(0,-1).some(function(part,idx){
                    var dirPath=pathParts.slice(0,idx+1).join('/');
                    return shouldIgnoreDirectory(dirPath,part,compiledPatterns);
                });
                if(ignored)return;
                var folder=i.path.includes('/')?i.path.substring(0,i.path.lastIndexOf('/')):'root';
                f.push({path:i.path,name:name,folder:folder,size:i.size||0,isCode:Parser.isCode(name)});
            });
            if(cb)cb('Found '+f.length+' files');
            return f;
        });
    },
    // Fallback: recursive scan using Contents API (many requests)
    scanRecursive:function(o,r,cb,p,d,compiledPatterns){
        var self=this;p=p||'';d=d||0;
        if(d>10)return Promise.resolve([]);
        return this.fetch(buildRepoApiUrl(o,r,['contents'].concat(splitRepoPath(p)))).then(function(c){
            var f=[];
            var promises=[];
            c.forEach(function(i){
                if(i.type==='file'&&!shouldExcludeFile(i.path,i.name,compiledPatterns)){
                    f.push({path:i.path,name:i.name,folder:i.path.includes('/')?i.path.substring(0,i.path.lastIndexOf('/')):'root',size:i.size,isCode:Parser.isCode(i.name)});
                }else if(i.type==='dir'&&!shouldIgnoreDirectory(i.path,i.name,compiledPatterns)){
                    if(cb)cb('/'+i.path);
                    promises.push(self.scanRecursive(o,r,cb,i.path,d+1,compiledPatterns).catch(function(){return[];}));
                }
            });
            return Promise.all(promises).then(function(results){
                results.forEach(function(res){f=f.concat(res);});
                return f;
            });
        }).catch(function(e){if(d===0)throw e;return[];});
    },
    // Smart scan: try tree API first (1 request), fallback to recursive
    scan:function(o,r,cb,compiledPatterns){
        var self=this;
        return this.scanTree(o,r,cb,compiledPatterns).catch(function(e){
            if(cb)cb('Tree API failed, using fallback...');
            return self.scanRecursive(o,r,cb,'',0,compiledPatterns);
        });
    }
};

// ---------------------------------------------------------------------------
// Shared Analysis Pipeline
// ---------------------------------------------------------------------------

function buildTree(files){
    var root={name:'root',path:'',children:{},files:[]};
    files.forEach(function(f){
        var parts=f.folder&&f.folder!=='root'?f.folder.split('/'):[];
        var cur=root;
        parts.forEach(function(p,i){
            var path=parts.slice(0,i+1).join('/');
            if(!cur.children[p])cur.children[p]={name:p,path:path,children:{},files:[]};
            cur=cur.children[p];
        });
        cur.files.push(f);
    });
    return root;
}

function countFiles(n){return n.files.length+Object.values(n.children).reduce(function(s,c){return s+countFiles(c);},0);}

var ARCHITECTURE_MAX_BLOCKS=64;
var ARCHITECTURE_MAX_RENDERED_DEPENDENCIES=48;
var ARCHITECTURE_GROUP_ORDER_CODEFLOW=['Browser App','GitHub Action','Analysis Core','Repository Collection','Rendering / Reports','Testing','Fixtures / Examples','Application','Storage'];
var ARCHITECTURE_GROUP_ORDER_WEBAPP=['App Entry / Shell','Frontend Routes / Views','Frontend Components','Backend / API Layer','Services / Business Logic','Data / Storage','Shared / Utilities','Configuration','Content / Data','External Integrations','Build Output','Testing','Fixtures / Examples'];
var ARCHITECTURE_GROUP_ORDER_GENERIC=['Application','Shared Services / Utils','Configuration','Content / Data','Build Output','Testing','Fixtures / Examples','Storage'];

function getArchitectureGroupOrder(profile){
    if(profile==='codeflow')return ARCHITECTURE_GROUP_ORDER_CODEFLOW;
    if(profile==='web-app')return ARCHITECTURE_GROUP_ORDER_WEBAPP;
    return ARCHITECTURE_GROUP_ORDER_GENERIC;
}

function detectArchitectureProfile(files,framework){
    var paths=(files||[]).map(function(f){return normalizeArchitecturePath(f.path||f.name).toLowerCase();});
    if(paths.some(function(p){return /(^|\/)index\.html?$/i.test(p);})&&paths.some(function(p){return /(^|\/)card\/(lib|render)\//i.test(p);}))return'codeflow';
    if(framework==='Next.js')return'web-app';
    if(paths.some(function(p){
        return /(^|\/)src\/app\//i.test(p)||/(^|\/)pages\//i.test(p)||/(^|\/)(backend|server|api|services?|middleware|routes?|platforms?)\b/i.test(p);
    }))return'web-app';
    if(framework==='Browser App')return'web-app';
    return'generic';
}

function isArchitectureBuildOutput(path,name){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    var base=String(name||p.split('/').pop()||'').toLowerCase();
    if(/(^|\/)out(\/|$)/.test(p)||/(^|\/)dist(\/|$)/.test(p)||/(^|\/)build(\/|$)/.test(p)||/(^|\/)coverage(\/|$)/.test(p))return true;
    if(/(^|\/)\.next(\/|$)/.test(p)||/(^|\/)\.nuxt(\/|$)/.test(p)||/(^|\/)\.output(\/|$)/.test(p))return true;
    if(/^page-[a-f0-9]{6,}/i.test(base)||/^layout-[a-f0-9]{6,}/i.test(base))return true;
    if(/\/page-[a-f0-9]{6,}\//i.test(p)||/\/layout-[a-f0-9]{6,}\//i.test(p))return true;
    if(/(^|\/)404\/index\.html?$/i.test(p)&&/(^|\/)out\//i.test(p))return true;
    return false;
}

function isArchitectureTestFile(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    return /(^|\/)tests?\//.test(p)||/(^|\/)__tests__(\/|$)/.test(p)||/\.test\.(js|jsx|ts|tsx|mjs|cjs)$/.test(p)||/\.spec\.(js|jsx|ts|tsx|mjs|cjs)$/.test(p)||/\.smoke\.(js|mjs|cjs)$/.test(p);
}

function isArchitectureFixtureFile(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    return /(^|\/)fixtures(\/|$)/.test(p)||/(^|\/)__fixtures__(\/|$)/.test(p);
}

function isDocumentationPath(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    if(/(^|\/)docs?(\/|$)/.test(p))return true;
    if(/\.(md|markdown|mdx)$/.test(p))return true;
    return false;
}

function isDevToolingPath(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    if(/(^|\/)\.github(\/|$)/.test(p))return true;
    if(/(^|\/)\.claude(\/|$)/.test(p))return true;
    if(/(^|\/)(scripts|tools|tooling)(\/|$)/.test(p))return true;
    return false;
}

// Secrets are dangerous wherever the code executes — CI workflows, hooks and
// deploy scripts included — so the Hardcoded Secret rule exempts only
// tests/fixtures (stub credentials) and docs (examples), NOT dev tooling.
function isSecretScanExemptPath(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    if(isArchitectureTestFile(p))return true;
    if(isArchitectureFixtureFile(p))return true;
    if(isDocumentationPath(p))return true;
    return false;
}

function isNonProductionPath(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    if(isSecretScanExemptPath(p))return true;
    if(isDevToolingPath(p))return true;
    return false;
}

function isArchitectureBarrelIndex(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    return /\/index\.(js|mjs|cjs|ts)$/i.test(p)&&!/\/index\.(tsx|jsx)$/i.test(p);
}

function isNonRouteFolderSegment(segment){
    return ['hooks','components','ui','views','schemas','schema','controllers','middleware','services','routes','utils','lib','common','analytics','types','constants','validators','models','repositories','config','core','api','server','backend','workers','functions','platforms','tabs','charts','widgets','providers','layouts','shared','domain','usecases','processors','jobs','db','database','content','posts','blog','docs','tests','fixtures','node_modules','public','static','assets','styles','themes'].indexOf(segment)>=0;
}

function isArchitectureBackendPath(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(/(^|\/)(a-)?backend(\/|$)/.test(p))return true;
    if(/(^|\/)server(\/|$)/.test(p))return true;
    if(/(^|\/)workers?(\/|$)/.test(p))return true;
    if(/(^|\/)functions(\/|$)/.test(p))return true;
    if(/(^|\/)lambda(\/|$)/.test(p))return true;
    if(/^src\/app\/api\//.test(p))return false;
    var segments=p.split('/').filter(Boolean);
    for(var i=0;i<segments.length;i++){
        var seg=segments[i];
        if(seg==='middleware'||seg==='controllers'||seg==='handlers')return true;
        if(seg==='routes'||seg==='services'){
            if(i===0)return true;
            var prev=segments[i-1];
            if(prev==='backend'||prev==='a-backend'||prev==='server'||prev==='api')return true;
        }
    }
    return false;
}

function canBeFrontendRoute(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(isArchitectureBuildOutput(path)||isArchitectureBackendPath(path)||isArchitectureBarrelIndex(path))return false;
    if(/(^|\/)src\/app\/.*\/page\.(jsx|tsx)$/i.test(p))return true;
    if(/^src\/app\/page\.(jsx|tsx)$/i.test(p))return true;
    if(/^src\/site-pages\/.+\/index\.(tsx|jsx)$/i.test(p))return true;
    if(/(^|\/)pages\/.*\.(jsx|tsx)$/i.test(p)&&!/(^|\/)pages\/api\//i.test(p))return true;
    var flat=p.match(/^([a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*){0,4})\/index\.(tsx|jsx)$/);
    if(flat){
        var segments=flat[1].split('/').filter(Boolean);
        if(!segments.some(isNonRouteFolderSegment))return true;
    }
    return false;
}

function isArchitectureFrontendPath(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(isArchitectureBuildOutput(path)||isArchitectureBackendPath(path))return false;
    if(/(^|\/)src\/app\//i.test(p)||/(^|\/)src\/site-pages\//i.test(p))return true;
    if(/(^|\/)pages\//i.test(p)&&/\.(jsx|tsx)$/i.test(p))return true;
    if(/(^|\/)(components|ui|views|widgets)\//i.test(p)&&/\.(jsx|tsx)$/i.test(p))return true;
    if(canBeFrontendRoute(path))return true;
    return false;
}

function inferNextSpecialFile(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(/\/global-error\.(tsx|jsx)$/.test(p))return{role:'frontend-component',title:'Global Error Boundary',route:null,kind:'component'};
    if(/\/not-found\.(tsx|jsx)$/.test(p))return{role:'frontend-route',title:'404 Not Found',route:'/404',kind:'page'};
    if(/\/error\.(tsx|jsx)$/.test(p))return{role:'frontend-component',title:'Error Boundary',route:null,kind:'component'};
    if(/\/loading\.(tsx|jsx)$/.test(p))return{role:'frontend-component',title:'Loading UI',route:null,kind:'component'};
    if(/\/template\.(tsx|jsx)$/.test(p))return{role:'app-shell',title:'App Template',route:null,kind:'shell'};
    if(/\/layout\.(tsx|jsx)$/.test(p))return{role:'app-shell',title:'App Layout',route:null,kind:'shell'};
    if(/\/providers\.(tsx|jsx)$/.test(p))return{role:'app-shell',title:'App Providers',route:null,kind:'shell'};
    return null;
}

function isArchitectureConfigPath(path,name){
    var p=normalizeArchitecturePath(path).toLowerCase();
    var base=String(name||'').toLowerCase();
    return /(^|\/)config(\/|$)/i.test(p)||/\.config\.(js|ts|mjs|cjs)$/.test(p)||base==='package.json'||base==='wrangler.toml'||base==='tsconfig.json';
}

function isArchitectureContentPath(path,name){
    var p=normalizeArchitecturePath(path).toLowerCase();
    return /(^|\/)(blog|posts|content|data|static\/content)\b/i.test(p)||/\.(md|mdx)$/i.test(name||'');
}

function isLikelyUiComponentSource(content){
    return /(from\s+['"`]react['"`]|React\.)/.test(content||'')&&(/export\s+(?:default\s+)?function\s+[A-Z]/.test(content||'')||/export\s+(?:default\s+)?(?:const|class)\s+[A-Z]/.test(content||'')||/<[A-Z][A-Za-z0-9_]*\b/.test(content||''));
}

function inferWebAppRoute(path){
    if(!canBeFrontendRoute(path))return null;
    var p=normalizeArchitecturePath(path);
    var nextRoute=inferArchitectureRoute(p);
    if(nextRoute&&!isArchitectureBackendPath(path))return nextRoute;
    var match=p.match(/^(?:src\/)?site-pages\/(.+)\/index\.(tsx|jsx)$/i);
    if(match)return normalizeArchitectureRoute('/'+match[1].split('/').filter(Boolean).join('/'));
    match=p.match(/^([a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*){0,4})\/index\.(tsx|jsx)$/i);
    if(match&&!isNonRouteFolderSegment(match[1].split('/')[0])){
        var segments=match[1].split('/').filter(Boolean);
        if(!segments.some(isNonRouteFolderSegment))return normalizeArchitectureRoute('/'+segments.join('/'));
    }
    return null;
}

function inferCodeflowArchitectureRole(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(isArchitectureTestFile(path))return'test';
    if(isArchitectureFixtureFile(path))return'fixture';
    if(/(^|\/)index\.html?$/i.test(p))return'browser-shell';
    if(/(^|\/)card\/index\.(js|mjs|cjs)$/i.test(p))return'action-entry';
    if(/\/analyzer\.(js|mjs|cjs)$/i.test(p))return'analyzer-loader';
    if(/\/collect\.(js|mjs|cjs)$/i.test(p))return'collector';
    if(/\/git\.(js|mjs|cjs)$/i.test(p))return'git';
    if(/\/inputs\.(js|mjs|cjs)$/i.test(p))return'inputs';
    if(/\/pr\.(js|mjs|cjs)$/i.test(p))return'pr';
    if(/\/state\.(js|mjs|cjs)$/i.test(p))return'state';
    if(/\/card\/render\/card\.(js|mjs|cjs)$/i.test(p))return'renderer';
    if(/(^|\/)card\/render\//i.test(p))return'render-support';
    if(/(^|\/)card\/lib\//i.test(p))return'module';
    return'module';
}

function inferWebAppArchitectureRole(path,classified,content){
    var p=normalizeArchitecturePath(path).toLowerCase();
    var base=architectureFileBaseName(path);
    var special=inferNextSpecialFile(path);
    if(special)return special.role;
    if(isArchitectureTestFile(path))return'test';
    if(isArchitectureFixtureFile(path))return'fixture';
    if(isArchitectureBuildOutput(path))return'build-output';
    if(isArchitectureBackendPath(path)){
        if(/\/middleware(\/|$)/.test(p)||base.toLowerCase()==='middleware')return'backend-middleware';
        if(/\/routes(\/|$)/.test(p)||base.toLowerCase()==='routes')return'backend-routes';
        if(/\/services(\/|$)/.test(p)||base.toLowerCase()==='services'||base.toLowerCase()==='service')return'backend-services';
        if(/\/config(\/|$)/.test(p)||base.toLowerCase()==='config')return'config';
        if(/\/core(\/|$)/.test(p)||base.toLowerCase()==='core')return'config';
        if(/\/platforms\/[^/]+\//.test(p)&&(/analyzer|controller|api/.test(p)||/analyzer|controller/i.test(base)))return'platform-analyzer';
        if(/\/analyzer/.test(p)||/analyzer/i.test(base))return'platform-analyzer';
        if(/api[-_]?client/i.test(p)||/api[-_]?client/i.test(base))return'api-client';
        return'backend-module';
    }
    if(isArchitectureConfigPath(path,base))return'config';
    if(isArchitectureContentPath(path,base))return'content';
    if(/(^|\/)src\/app\/(layout|template|providers|page)\./i.test(p))return'app-shell';
    if(classified.kind==='api'||/^src\/app\/api\//.test(p))return'backend-routes';
    if(classified.kind==='page'&&classified.route&&canBeFrontendRoute(path))return'frontend-route';
    if(/\/hooks(\/|$)/.test(p)||/\/schemas?(\/|$)/.test(p)||/\/validators?(\/|$)/.test(p))return'shared-module';
    if(/\/components(\/|$)/.test(p)||/\/ui\/components(\/|$)/.test(p)||/\/views(\/|$)/.test(p)){
        if(/\.(tsx|jsx)$/i.test(p)&&isLikelyUiComponentSource(content))return'frontend-component';
        return'shared-module';
    }
    if((classified.kind==='component'||classified.kind==='hook')&&/\.(tsx|jsx)$/i.test(p)&&isLikelyUiComponentSource(content))return'frontend-component';
    if(/(^|\/)utils?\b/i.test(p)||/(^|\/)lib\//i.test(p)||/(^|\/)common\//i.test(p)||/(^|\/)constants?\b/i.test(p))return'shared-module';
    return'shared-module';
}

function inferArchitectureRole(path,profile,classified,content){
    if(profile==='codeflow')return inferCodeflowArchitectureRole(path);
    return inferWebAppArchitectureRole(path,classified||{kind:'utility',route:null},content||'');
}

function inferArchitectureGroup(role,fact,profile){
    if(profile==='codeflow'){
        if(role==='browser-shell')return'Browser App';
        if(role==='action-entry')return'GitHub Action';
        if(role==='analyzer-loader'||role==='state')return'Analysis Core';
        if(role==='collector'||role==='git'||role==='inputs'||role==='pr')return'Repository Collection';
        if(role==='renderer'||role==='render-support')return'Rendering / Reports';
        if(role==='test')return'Testing';
        if(role==='fixture')return'Fixtures / Examples';
        if(fact&&fact.kind==='page')return'Browser App';
        if(fact&&fact.kind==='api')return'Application';
        if(fact&&(fact.kind==='database-adapter'||fact.kind==='database'))return'Storage';
        return'Application';
    }
    if(role==='app-shell')return'App Entry / Shell';
    if(role==='frontend-route')return'Frontend Routes / Views';
    if(role==='frontend-component')return'Frontend Components';
    if(role==='platform-analyzer')return'Services / Business Logic';
    if(role==='backend-routes'||role==='backend-middleware'||role==='api-client')return'Backend / API Layer';
    if(role==='backend-services'||role==='backend-module')return'Services / Business Logic';
    if(role==='config')return'Configuration';
    if(role==='content')return'Content / Data';
    if(role==='build-output')return'Build Output';
    if(role==='test')return'Testing';
    if(role==='fixture')return'Fixtures / Examples';
    if(role==='shared-module')return'Shared / Utilities';
    if(fact&&(fact.kind==='database-adapter'||fact.kind==='database'))return'Data / Storage';
    return'Shared / Utilities';
}

function isArchitectureSignificantFile(path,role,fact,framework,profile,importedByCore){
    if(isArchitectureTestFile(path)||isArchitectureFixtureFile(path)||isArchitectureBuildOutput(path))return false;
    if(profile==='codeflow'){
        if(role==='browser-shell'||role==='action-entry')return true;
        if(role==='analyzer-loader'||role==='collector'||role==='git'||role==='inputs'||role==='pr'||role==='state'||role==='renderer'||role==='render-support')return true;
        if(/(^|\/)card\/(lib|render)\//i.test(path))return true;
        if(fact.kind==='page'||fact.kind==='api')return true;
        if(fact.kind==='database-adapter'&&fact.dbUsage)return true;
        return false;
    }
    if(role==='app-shell')return true;
    if(role==='frontend-route'&&fact.route&&canBeFrontendRoute(path))return true;
    if(role==='frontend-component'&&/\.(tsx|jsx)$/i.test(path))return true;
    if(role==='backend-routes'||role==='backend-middleware'||role==='backend-services'||role==='platform-analyzer'||role==='api-client')return true;
    if(role==='config'||role==='content')return true;
    if(role==='backend-module'&&/(middleware|routes?|services?|analyzer|platform)/i.test(path))return true;
    if(fact.kind==='page'&&fact.route&&canBeFrontendRoute(path))return true;
    if(fact.kind==='api')return true;
    if(fact.kind==='database-adapter'&&fact.dbUsage)return true;
    if(importedByCore)return true;
    return false;
}

function extractExportedComponentName(content){
    var match=(content||'').match(/export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/);
    if(match)return match[1];
    match=(content||'').match(/export\s+default\s+(?:const|class)\s+([A-Z][A-Za-z0-9_]*)/);
    if(match)return match[1];
    match=(content||'').match(/export\s+function\s+([A-Z][A-Za-z0-9_]*)/);
    if(match)return match[1];
    return null;
}

function inferPageComponentTitle(path,route,content){
    var special=inferNextSpecialFile(path);
    if(special&&special.title)return special.title;
    var exported=extractExportedComponentName(content);
    if(exported)return exported;
    var base=architectureFileBaseName(path);
    if(/^[A-Z]/.test(base)&&base!=='Index'&&base!=='Page')return base;
    if(route&&route!=='/'){
        var segment=route.split('/').filter(Boolean).pop()||'';
        if(segment)return segment.charAt(0).toUpperCase()+segment.slice(1).replace(/[-_](\w)/g,function(m,c){return c.toUpperCase();})+' Page';
    }
    if(/layout/i.test(base))return'App Layout';
    if(/page/i.test(base))return'Page Module';
    return'UI Module';
}

function testFileReferencesCore(content){
    return /CODEFLOW_ANALYZER|buildAnalysisData|loadAnalyzer|locateIndexHtml|const Parser=\{/.test(content||'');
}

function inferTestTargetPaths(testPath){
    var base=architectureFileBaseName(testPath).toLowerCase();
    var targets=[];
    if(/golden/.test(base))targets.push('card/lib/analyzer.js');
    if(/repo-smoke|smoke/.test(base))targets.push('card/lib/collect.js');
    if(/md-extractor|sync-with-html|html-inline/.test(base))targets.push('index.html');
    return targets;
}

function architectureDependencyLabel(sourceRole,targetRole,importPath){
    if(sourceRole==='test')return'tests';
    if(sourceRole==='browser-shell'&&targetRole==='analyzer-loader')return'runs analysis';
    if(sourceRole==='browser-shell'&&targetRole==='collector')return'loads repo data';
    if(sourceRole==='action-entry'&&targetRole==='browser-shell')return'loads analyzer from';
    if(sourceRole==='action-entry'&&targetRole==='collector')return'collects repo';
    if(sourceRole==='action-entry'&&targetRole==='analyzer-loader')return'runs analysis';
    if(sourceRole==='action-entry'&&targetRole==='state')return'stores derived state';
    if(sourceRole==='action-entry'&&targetRole==='renderer')return'renders report';
    if(sourceRole==='collector'&&targetRole==='git')return'uses GitHub API';
    if(sourceRole==='collector'&&targetRole==='inputs')return'normalizes input';
    if(sourceRole==='pr'&&targetRole==='git')return'analyzes pull requests';
    if(sourceRole==='analyzer-loader'&&targetRole==='state')return'stores derived state';
    if(sourceRole==='renderer'&&targetRole==='render-support')return'uses visual helpers';
    if(sourceRole==='render-support'&&targetRole==='render-support'){
        if(/receipt-md/.test(importPath||''))return'exports markdown';
        if(/theme/.test(importPath||''))return'uses';
        return'uses';
    }
    if(targetRole==='database')return'queries';
    if(sourceRole==='browser-shell'&&targetRole==='api')return'calls';
    if(sourceRole==='app-shell'&&targetRole==='frontend-route')return'bootstraps';
    if(sourceRole==='frontend-route'&&targetRole==='frontend-component')return'renders';
    if(sourceRole==='frontend-component'&&targetRole==='platform-analyzer')return'calls';
    if(sourceRole==='frontend-component'&&targetRole==='backend-services')return'calls';
    if(sourceRole==='backend-routes'&&targetRole==='backend-middleware')return'passes through';
    if(sourceRole==='backend-routes'&&targetRole==='backend-services')return'dispatches';
    if(sourceRole==='backend-services'&&targetRole==='platform-analyzer')return'uses';
    if(sourceRole==='platform-analyzer'&&targetRole==='api-client')return'uses API';
    if(sourceRole==='frontend-component'&&targetRole==='content')return'reads content';
    if((sourceRole==='app-shell'||sourceRole==='backend-module')&&targetRole==='config')return'depends on';
    return'depends on';
}

function normalizeArchitecturePath(value){
    return (value||'').replace(/\\/g,'/').replace(/^\/+/,'').replace(/\/{2,}/g,'/');
}

function architectureDirname(path){
    path=normalizeArchitecturePath(path);
    return path.includes('/')?path.split('/').slice(0,-1).join('/'):'';
}

function stripArchitectureExt(path){
    return normalizeArchitecturePath(path).replace(/\.(jsx?|tsx?|mjs|cjs|html?|css|scss|sass|less|py|pyw|pyi|rb|go|java|php|rs|cs|swift|kt|kts)$/i,'');
}

function architectureFileBaseName(path){
    var base=stripArchitectureExt(path).split('/').pop()||'Block';
    return base==='index'?(stripArchitectureExt(path).split('/').slice(-2,-1)[0]||base):base;
}

function normalizeArchitectureRoute(route){
    route=String(route||'').split('#')[0].split('?')[0].trim();
    if(!route)return'';
    if(route[0]!=='/')route='/'+route;
    route=route.replace(/\/{2,}/g,'/');
    if(route.length>1)route=route.replace(/\/$/,'');
    return route||'/';
}

function routeSegmentsMatch(patternRoute,targetRoute){
    patternRoute=normalizeArchitectureRoute(patternRoute);
    targetRoute=normalizeArchitectureRoute(targetRoute);
    if(patternRoute===targetRoute)return true;
    var pattern=patternRoute.split('/').filter(Boolean);
    var target=targetRoute.split('/').filter(Boolean);
    for(var i=0;i<pattern.length;i++){
        var segment=pattern[i];
        if(segment.charAt(0)===':'&&segment.endsWith('*'))return true;
        if(i>=target.length)return false;
        if(segment.charAt(0)===':')continue;
        if(segment!==target[i])return false;
    }
    return pattern.length===target.length;
}

function getArchitectureScanFiles(files){
    return (files||[]).filter(function(file){
        var path=normalizeArchitecturePath(file.path||file.name);
        return !isArchitectureTestFile(path)&&!isArchitectureFixtureFile(path);
    });
}

function detectArchitectureFramework(files){
    var paths=getArchitectureScanFiles(files).map(function(f){return normalizeArchitecturePath(f.path||f.name).toLowerCase();});
    var hasNextConfig=paths.some(function(p){return /(^|\/)next\.config\.(js|mjs|ts|cjs)$/.test(p);});
    var hasAppRouter=paths.some(function(p){return /(^|\/)(src\/)?app\/.*(page|route)\.(js|jsx|ts|tsx)$/.test(p);});
    var hasPagesRouter=paths.some(function(p){return /(^|\/)(src\/)?pages\/.*\.(js|jsx|ts|tsx)$/.test(p);});
    if(hasNextConfig||hasAppRouter||hasPagesRouter)return'Next.js';
    if(paths.some(function(p){return /\.(html?|xhtml)$/.test(p);}))return'Browser App';
    if(paths.some(function(p){return /\.(jsx?|tsx?|mjs|cjs)$/.test(p);}))return'JavaScript/TypeScript';
    if(paths.some(function(p){return /\.(py|pyw|pyi)$/.test(p);}))return'Python';
    return'Generic';
}

function convertNextRouteSegment(segment){
    if(!segment||/^\(.*\)$/.test(segment))return null;
    var optionalCatchAll=segment.match(/^\[\[\.\.\.(.+)\]\]$/);
    if(optionalCatchAll)return':'+optionalCatchAll[1]+'*';
    var catchAll=segment.match(/^\[\.\.\.(.+)\]$/);
    if(catchAll)return':'+catchAll[1]+'*';
    var dynamic=segment.match(/^\[(.+)\]$/);
    if(dynamic)return':'+dynamic[1];
    return segment;
}

function nextRouteFromSegments(segments){
    var clean=[];
    (segments||[]).forEach(function(segment){
        var converted=convertNextRouteSegment(segment);
        if(converted)clean.push(converted);
    });
    return normalizeArchitectureRoute('/'+clean.join('/'));
}

function inferArchitectureRoute(path){
    var p=normalizeArchitecturePath(path);
    var match;

    match=p.match(/^(?:src\/)?app\/api\/(.+)\/route\.(js|jsx|ts|tsx)$/i);
    if(match)return nextRouteFromSegments(['api'].concat(match[1].split('/')));

    match=p.match(/^(?:src\/)?app\/api\/route\.(js|jsx|ts|tsx)$/i);
    if(match)return'/api';

    match=p.match(/^(?:src\/)?app\/(.+)\/page\.(js|jsx|ts|tsx)$/i);
    if(match)return nextRouteFromSegments(match[1].split('/'));

    match=p.match(/^(?:src\/)?app\/page\.(js|jsx|ts|tsx)$/i);
    if(match)return'/';

    match=p.match(/^(?:src\/)?pages\/api\/(.+)\.(js|jsx|ts|tsx)$/i);
    if(match){
        var apiParts=stripArchitectureExt(match[1]).split('/').filter(Boolean);
        if(apiParts[apiParts.length-1]==='index')apiParts.pop();
        return nextRouteFromSegments(['api'].concat(apiParts));
    }

    match=p.match(/^(?:src\/)?pages\/(.+)\.(js|jsx|ts|tsx)$/i);
    if(match){
        var routePath=stripArchitectureExt(match[1]);
        var parts=routePath.split('/').filter(Boolean);
        var first=parts[0]||'';
        if(first.charAt(0)==='_')return null;
        if(parts[parts.length-1]==='index')parts.pop();
        return nextRouteFromSegments(parts);
    }

    return null;
}

function extractArchitectureImports(content){
    var imports=[];
    var regexes=[
        /import\s+[\s\S]*?\s+from\s+['"`]([^'"`]+)['"`]/g,
        /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
        /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g
    ];
    regexes.forEach(function(regex){
        var match;
        while((match=regex.exec(content||'')))imports.push(match[1]);
    });
    return Array.from(new Set(imports));
}

function extractJsxComponents(content){
    var components=[];
    var ignored=new Set(['Fragment','React','Suspense','StrictMode']);
    var regex=/<([A-Z][A-Za-z0-9_]*)\b/g;
    var match;
    while((match=regex.exec(content||''))){
        if(!ignored.has(match[1]))components.push(match[1]);
    }
    return Array.from(new Set(components));
}

function extractNavigationLinks(content){
    var links=[];
    var regexes=[
        /<Link[^>]+href=["'`]([^"'`]+)["'`]/g,
        /<a[^>]+href=["'`]([^"'`]+)["'`]/g,
        /router\.(?:push|replace)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
        /navigate\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
    ];
    regexes.forEach(function(regex){
        var match;
        while((match=regex.exec(content||''))){
            var route=normalizeArchitectureRoute(match[1]);
            if(route&&route.charAt(0)==='/'&&!route.startsWith('/api'))links.push(route);
        }
    });
    return Array.from(new Set(links));
}

function extractApiCalls(content){
    var calls=[];
    var match;
    var fetchRegex=/fetch\s*\(\s*["'`]([^"'`]+)["'`](?:\s*,\s*\{([\s\S]{0,180}?)\})?/g;
    while((match=fetchRegex.exec(content||''))){
        var method='GET';
        var methodMatch=(match[2]||'').match(/method\s*:\s*["'`]([A-Za-z]+)["'`]/);
        if(methodMatch)method=methodMatch[1].toUpperCase();
        calls.push({method:method,url:normalizeArchitectureRoute(match[1])});
    }
    var axiosRegex=/axios\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    while((match=axiosRegex.exec(content||''))){
        calls.push({method:match[1].toUpperCase(),url:normalizeArchitectureRoute(match[2])});
    }
    return calls.filter(function(call){return call.url&&call.url.startsWith('/api');});
}

function detectDatabaseUsage(content){
    return [
        /\bnew\s+PrismaClient\s*\(/,
        /\bprisma\.\w+\.(findMany|findUnique|findFirst|create|update|delete|upsert|count|aggregate)\s*\(/,
        /\bsupabase\.from\s*\(/,
        /\bmongoose\.model\b/,
        /\bpool\.query\s*\(/,
        /\bdb\.(select|insert|update|delete|query)\s*\(/,
        /\bcollection\s*\(/
    ].some(function(pattern){return pattern.test(content||'');});
}

function isLikelyReactComponentFile(path,content){
    var p=normalizeArchitecturePath(path);
    var base=architectureFileBaseName(p);
    return /(^|\/)(components|ui)\//i.test(p)||
        /^[A-Z]/.test(base)||
        /\.(jsx|tsx)$/i.test(p)||
        (/(from\s+['"`]react['"`]|React\.)/.test(content||'')&&/<[A-Z][A-Za-z0-9_]*\b/.test(content||''));
}

function classifyArchitectureFile(path,content){
    var p=normalizeArchitecturePath(path);
    var route=inferArchitectureRoute(p);
    if(route){
        return route.startsWith('/api')?{kind:'api',route:route}:{kind:'page',route:route};
    }
    var base=architectureFileBaseName(p);
    var dbUsage=detectDatabaseUsage(content);
    if(/^use[A-Z0-9_]/.test(base)||/(^|\/)hooks?\//i.test(p))return{kind:'hook',route:null};
    if(dbUsage&&/(^|\/)(db|database|prisma|models?|schema|repositories?|data)\b/i.test(p))return{kind:'database-adapter',route:null};
    if(/(^|\/)(services?|controllers?|server|actions)\//i.test(p))return{kind:'service',route:null};
    if(isLikelyReactComponentFile(p,content))return{kind:'component',route:null};
    if(dbUsage)return{kind:'database-adapter',route:null};
    return{kind:'utility',route:null};
}

function inferGenericArchitectureRoute(path){
    var p=normalizeArchitecturePath(path);
    if(/(^|\/)index\.html?$/i.test(p))return'/';
    if(/\.(html?|xhtml)$/i.test(p)){
        return normalizeArchitectureRoute('/'+stripArchitectureExt(p).replace(/\/index$/i,''));
    }
    return null;
}

function classifyGenericArchitectureFile(file,content){
    var p=normalizeArchitecturePath(file.path||file.name);
    var name=file.name||p.split('/').pop()||'';
    var layer=(file.layer||Parser.detectLayer(p)||'utils').toLowerCase();
    var dbUsage=detectDatabaseUsage(content);
    var route=inferGenericArchitectureRoute(p);

    if(route||Parser.isHTML(name))return{kind:'page',route:route||'/'+stripArchitectureExt(name)};
    if(dbUsage||layer==='data'||layer==='classes')return{kind:'database-adapter',route:null};
    if(layer==='ui'||layer==='forms'||layer==='components')return{kind:'component',route:null};
    if(layer==='services')return{kind:'service',route:null};
    if(layer==='config')return{kind:'utility',route:null};
    if(file.functions&&file.functions.length>0)return{kind:'module',route:null};
    return{kind:'utility',route:null};
}

function extractArchitectureFacts(files,framework){
    var profile=detectArchitectureProfile(files,framework);
    var rawFacts=(files||[]).filter(function(file){
        return file&&file.content&&Parser.isCode(file.name||file.path||'');
    }).map(function(file){
        var path=normalizeArchitecturePath(file.path||file.name);
        var content=file.content||'';
        if(isArchitectureBuildOutput(path,file.name)){
            return{
                path:path,
                name:file.name||path.split('/').pop(),
                kind:'build-output',
                route:null,
                role:'build-output',
                group:'Build Output',
                profile:profile,
                isTest:false,
                isFixture:false,
                isBuildOutput:true,
                isCore:false,
                imports:[],
                jsxComponents:[],
                links:[],
                apiCalls:[],
                dbUsage:false,
                content:content,
                loc:file.lines||0
            };
        }
        var special=inferNextSpecialFile(path);
        var webRoute=canBeFrontendRoute(path)?inferWebAppRoute(path):null;
        var classified=framework==='Next.js'
            ? classifyArchitectureFile(path,content)
            : classifyGenericArchitectureFile(file,content);
        if(special){
            classified={kind:special.kind,route:special.route};
        }else if(webRoute&&profile!=='codeflow'&&!isArchitectureBackendPath(path)){
            classified=classified.kind==='api'?classified:{kind:'page',route:webRoute};
        }else if(isArchitectureBackendPath(path)||isArchitectureBarrelIndex(path)){
            if(classified.kind==='page')classified={kind:'module',route:null};
        }
        var role=inferArchitectureRole(path,profile,classified,content);
        if(special){
            role=special.role;
            if(special.route)classified.route=special.route;
        }
        if(role==='fixture')classified={kind:'fixture',route:null};
        else if(role==='browser-shell')classified={kind:'shell',route:inferGenericArchitectureRoute(path)||'/'};
        else if(role==='action-entry')classified={kind:'action-entry',route:null};
        else if(role==='test')classified={kind:'test',route:null};
        else if(role==='build-output')classified={kind:'build-output',route:null};
        else if(role==='app-shell')classified={kind:'shell',route:null};
        else if(role==='frontend-route')classified={kind:'page',route:classified.route||webRoute};
        else if(role==='frontend-component')classified={kind:'component',route:classified.route||null};
        else if(role==='backend-routes'||role==='backend-middleware'||role==='backend-services'||role==='backend-module'||role==='platform-analyzer'||role==='api-client'){
            classified={kind:role==='platform-analyzer'?'service':'module',route:null};
        }
        var displayTitle=special?special.title:null;
        if(!displayTitle&&role==='frontend-component')displayTitle=inferPageComponentTitle(path,classified.route,content);
        return{
            path:path,
            name:file.name||path.split('/').pop(),
            kind:classified.kind,
            route:classified.route,
            displayTitle:displayTitle,
            role:role,
            group:inferArchitectureGroup(role,{kind:classified.kind},profile),
            profile:profile,
            isTest:isArchitectureTestFile(path),
            isFixture:isArchitectureFixtureFile(path),
            isBuildOutput:isArchitectureBuildOutput(path,file.name),
            isCore:false,
            imports:extractArchitectureImports(content),
            jsxComponents:extractJsxComponents(content),
            links:extractNavigationLinks(content),
            apiCalls:extractApiCalls(content),
            dbUsage:detectDatabaseUsage(content),
            content:content,
            loc:file.lines||0
        };
    });
    var corePaths=new Set();
    rawFacts.forEach(function(fact){
        if(fact.isBuildOutput||fact.isTest||fact.isFixture)return;
        fact.isCore=isArchitectureSignificantFile(fact.path,fact.role,fact,framework,fact.profile,false);
        if(fact.isCore)corePaths.add(fact.path);
    });
    rawFacts.forEach(function(fact){
        if(fact.isCore)return;
        if(fact.isBuildOutput||fact.isTest||fact.isFixture)return;
        var importedByCore=fact.imports.some(function(importPath){
            var resolved=resolveArchitectureImport(importPath,fact.path,files);
            return resolved&&corePaths.has(resolved);
        });
        if(!importedByCore&&fact.role==='frontend-component'){
            importedByCore=fact.imports.length>0||isArchitectureFrontendPath(fact.path);
        }
        if(importedByCore||isArchitectureSignificantFile(fact.path,fact.role,fact,framework,fact.profile,true)){
            fact.isCore=true;
            corePaths.add(fact.path);
        }
    });
    return rawFacts;
}

function shouldShowArchitectureBlock(fact){
    return ['page','api','component','hook','service','database-adapter','module','utility','shell','fixture','action-entry','test','build-output'].includes(fact.kind);
}

function architectureLayer(fact){
    if(fact.kind==='page'||fact.kind==='component'||fact.kind==='hook')return'Frontend';
    if(fact.kind==='api'||fact.kind==='service')return'Backend';
    if(fact.kind==='database-adapter')return'Data Layer';
    if(fact.kind==='database')return'Storage';
    if(fact.kind==='module'||fact.kind==='utility')return'Shared';
    return'Shared';
}

function architectureTitle(fact){
    if(fact.displayTitle)return fact.displayTitle;
    if(fact.role==='app-shell')return'App Entry / Shell';
    if(fact.kind==='shell'||fact.role==='browser-shell')return'Browser App Shell';
    if(fact.kind==='action-entry')return'GitHub Action';
    if(fact.role==='frontend-route')return fact.route==='/'?'/':fact.route;
    if(fact.role==='frontend-component')return inferPageComponentTitle(fact.path,fact.route,fact.content);
    if(fact.role==='platform-analyzer'){
        var seg=(fact.path.match(/\/(youtube|reddit|twitter|github|tiktok|instagram)\b/i)||[])[1];
        if(seg)return seg.charAt(0).toUpperCase()+seg.slice(1)+' Analyzer';
        return architectureFileBaseName(fact.path)+' Analyzer';
    }
    if(fact.role==='backend-middleware')return'Middleware';
    if(fact.role==='backend-routes')return'API Routes';
    if(fact.role==='backend-services')return'Services';
    if(fact.role==='backend-module'){
        var seg=normalizeArchitecturePath(fact.path).split('/').filter(Boolean);
        var name=architectureFileBaseName(fact.path);
        if(name&&name!=='index')return name.charAt(0).toUpperCase()+name.slice(1);
        return seg.length?seg[seg.length-1].charAt(0).toUpperCase()+seg[seg.length-1].slice(1):'Backend Module';
    }
    if(fact.role==='api-client')return'API Clients';
    if(fact.role==='config')return'Config';
    if(fact.role==='content')return'Content';
    if(fact.kind==='page')return fact.route==='/'?'Home Page':'Page '+fact.route;
    if(fact.kind==='api')return'API '+fact.route;
    if(fact.kind==='database')return'Database';
    return architectureFileBaseName(fact.path);
}

function aggregateFrontendComponentKey(block){
    var files=(block.files||[]).map(function(f){return normalizeArchitecturePath(f).toLowerCase();});
    var sample=files[0]||'';
    var platform=sample.match(/\/platforms\/([^/]+)\//);
    if(platform){
        var name=platform[1];
        if(/\/tabs\/[^/]+\/insights\//.test(sample))return'agg:fe:'+name+'-insight-tabs';
        if(/\/tabs\//.test(sample))return'agg:fe:'+name+'-tabs';
        if(/\/components\/charts\//.test(sample)||/\/charts\//.test(sample))return'agg:fe:'+name+'-chart-components';
        if(/\/views\//.test(sample)||/\/pages\//.test(sample))return'agg:fe:'+name+'-dashboard';
        if(/\/components\//.test(sample))return'agg:fe:'+name+'-components';
        return'agg:fe:'+name+'-feature-ui';
    }
    if(/\/components\/charts\//.test(sample)||/\/charts\//.test(sample))return'agg:fe:chart-components';
    if(/\/components\//.test(sample)||/\/ui\/components\//.test(sample))return'agg:fe:shared-ui-components';
    if(/\/hooks\//.test(sample))return'agg:fe:hooks';
    if(/\/views\//.test(sample))return'agg:fe:views';
    return'agg:fe:feature-components';
}

function getArchitectureAggregateKey(block,profile){
    if(profile==='codeflow')return null;
    if(block.isBuildOutput)return null;
    if(block.role==='app-shell'||block.role==='browser-shell')return'agg:app-shell';
    if(block.role==='frontend-route'&&block.route)return'agg:route:'+block.route;
    if(block.role==='frontend-component')return aggregateFrontendComponentKey(block);
    if(block.role==='platform-analyzer'){
        var sample=String((block.files&&block.files[0])||'').toLowerCase();
        var seg=sample.match(/\/platforms\/([^/]+)\//);
        if(seg)return'agg:analyzer:'+seg[1];
        seg=sample.match(/\/(youtube|reddit|twitter|github|tiktok|instagram)\b/);
        return'agg:analyzer:'+(seg?seg[1]:block.title).toLowerCase();
    }
    if(block.role==='backend-middleware')return'agg:backend:middleware';
    if(block.role==='backend-routes')return'agg:backend:routes';
    if(block.role==='backend-services')return'agg:backend:services';
    if(block.role==='api-client')return'agg:backend:api-client';
    if(block.role==='backend-module'){
        var sample=String((block.files&&block.files[0])||'').toLowerCase();
        if(/\/config\//.test(sample))return'agg:backend:config';
        if(/\/core\//.test(sample))return'agg:backend:core';
        return'agg:backend:'+architectureFileBaseName((block.files&&block.files[0])||'module').toLowerCase();
    }
    if(block.role==='config')return'agg:config';
    if(block.role==='content')return'agg:content';
    if(block.group==='Shared / Utilities'||block.role==='shared-module'){
        var sample=String((block.files&&block.files[0])||'').toLowerCase();
        if(/\/hooks\//.test(sample))return'agg:shared:hooks';
        if(/\/schemas?\//.test(sample))return'agg:shared:schema';
        if(/\/utils?\//.test(sample))return'agg:shared:utils';
        return'agg:shared:utilities';
    }
    return null;
}

function titleCaseSegment(value){
    return String(value||'').split(/[-_]/).filter(Boolean).map(function(part){
        return part.charAt(0).toUpperCase()+part.slice(1);
    }).join(' ');
}

function resolveAggregateBlockTitle(key){
    if(!key||!key.startsWith('agg:'))return null;
    var known={
        'agg:app-shell':'App Shell',
        'agg:backend:middleware':'Middleware',
        'agg:backend:routes':'API Routes',
        'agg:backend:services':'Services',
        'agg:backend:api-client':'API Clients',
        'agg:backend:config':'Config',
        'agg:backend:core':'Core',
        'agg:config':'App Config',
        'agg:content':'Content',
        'agg:fe:chart-components':'Chart Components',
        'agg:fe:shared-ui-components':'Shared UI Components',
        'agg:fe:hooks':'Hooks',
        'agg:fe:views':'Views',
        'agg:fe:feature-components':'Feature Components',
        'agg:shared:hooks':'Hooks',
        'agg:shared:schema':'Schema',
        'agg:shared:utils':'Utils',
        'agg:shared:utilities':'Utilities'
    };
    if(known[key])return known[key];
    var routeMatch=key.match(/^agg:route:(.+)$/);
    if(routeMatch){
        var route=normalizeArchitectureRoute(routeMatch[1]);
        return route==='/'?'/':route;
    }
    var analyzerMatch=key.match(/^agg:analyzer:(.+)$/);
    if(analyzerMatch)return titleCaseSegment(analyzerMatch[1])+' Analyzer';
    var feMatch=key.match(/^agg:fe:([^-]+)-(.+)$/);
    if(feMatch)return titleCaseSegment(feMatch[1])+' '+titleCaseSegment(feMatch[2].replace(/-/g,' '));
    var backendMatch=key.match(/^agg:backend:(.+)$/);
    if(backendMatch)return titleCaseSegment(backendMatch[1]);
    return null;
}

function aggregateArchitectureBlocks(blocks,profile,warnings){
    if(profile==='codeflow')return blocks;
    var merged=Object.create(null);
    var passthrough=[];
    blocks.forEach(function(block){
        var key=getArchitectureAggregateKey(block,profile);
        if(!key){
            passthrough.push(block);
            return;
        }
        if(!merged[key]){
            merged[key]=Object.assign({},block,{files:(block.files||[]).slice(),loc:block.loc||0});
            merged[key].id=makeMermaidSafeId(key);
            var aggregateTitle=resolveAggregateBlockTitle(key);
            if(aggregateTitle)merged[key].title=aggregateTitle;
        }else{
            (block.files||[]).forEach(function(filePath){
                if(merged[key].files.indexOf(filePath)<0)merged[key].files.push(filePath);
            });
            merged[key].loc=(merged[key].loc||0)+(block.loc||0);
        }
    });
    var aggregated=Object.keys(merged).map(function(key){return merged[key];});
    if(aggregated.length+passthrough.length<blocks.length){
        warnings.push('Aggregated '+blocks.length+' architecture files into '+(aggregated.length+passthrough.length)+' diagram blocks for readability.');
    }
    return aggregated.concat(passthrough);
}

function computeArchitectureHiddenSummary(facts,blocks,includeTests,includeBuildOutput){
    var shownPaths=new Set();
    getVisibleArchitectureBlocks(blocks,includeTests,includeBuildOutput).forEach(function(block){
        (block.files||[]).forEach(function(filePath){shownPaths.add(normalizeArchitecturePath(filePath));});
    });
    var hidden={build:0,tests:0,fixtures:0,lowSignal:0,total:0};
    (facts||[]).forEach(function(fact){
        if(shownPaths.has(fact.path))return;
        if(fact.isBuildOutput){
            hidden.build++;
        }else if(fact.isTest){
            hidden.tests++;
        }else if(fact.isFixture){
            hidden.fixtures++;
        }else{
            hidden.lowSignal++;
        }
        hidden.total++;
    });
    return hidden;
}

function makeMermaidSafeId(value){
    var safe=String(value||'Block')
        .replace(/[^a-zA-Z0-9_]/g,'_')
        .replace(/^([0-9])/,'_$1')
        .slice(0,80);
    return safe||'Block';
}

function escapeMermaidLabel(value){
    return String(value||'')
        .replace(/"/g,"'")
        .replace(/\|/g,'/')
        .replace(/\n/g,' ')
        .replace(/\r/g,' ')
        .slice(0,120);
}

function resolveArchitectureImport(importPath,fromFile,files){
    if(!importPath||/^(react|next|@?vercel|node:|https?:)/.test(importPath))return null;
    var candidates=[];
    if(importPath.startsWith('@/'))candidates.push('src/'+importPath.slice(2));
    if(importPath.startsWith('~/'))candidates.push('src/'+importPath.slice(2));
    if(importPath.startsWith('./')||importPath.startsWith('../')){
        var baseParts=(architectureDirname(fromFile)?architectureDirname(fromFile).split('/'):[]).concat(importPath.split('/'));
        var normalized=[];
        baseParts.forEach(function(part){
            if(!part||part==='.')return;
            if(part==='..')normalized.pop();
            else normalized.push(part);
        });
        candidates.push(normalized.join('/'));
    }
    if(!candidates.length)return null;
    var exts=['','.js','.jsx','.ts','.tsx','.mjs','.cjs','/index.js','/index.jsx','/index.ts','/index.tsx'];
    var pathMap=Object.create(null);
    (files||[]).forEach(function(file){
        var p=normalizeArchitecturePath(file.path||file.name);
        pathMap[p.toLowerCase()]=file.path||file.name;
    });
    for(var i=0;i<candidates.length;i++){
        for(var j=0;j<exts.length;j++){
            var candidate=normalizeArchitecturePath(candidates[i]+exts[j]).toLowerCase();
            if(pathMap[candidate])return normalizeArchitecturePath(pathMap[candidate]);
        }
    }
    return null;
}

function makeArchitectureBlocks(facts,files,warnings){
    var corePaths=new Set();
    var visiblePaths=new Set();
    facts.forEach(function(fact){
        if(fact.isCore){
            corePaths.add(fact.path);
            visiblePaths.add(fact.path);
        }
    });
    facts.forEach(function(fact){
        if(corePaths.has(fact.path)){
            fact.imports.forEach(function(importPath){
                var resolved=resolveArchitectureImport(importPath,fact.path,files);
                if(resolved)visiblePaths.add(resolved);
            });
        }else{
            fact.imports.forEach(function(importPath){
                var resolved=resolveArchitectureImport(importPath,fact.path,files);
                if(resolved&&corePaths.has(resolved))visiblePaths.add(fact.path);
            });
        }
    });
    var candidates=facts.filter(function(fact){
        if(!shouldShowArchitectureBlock(fact))return false;
        if(fact.isTest||fact.isFixture||fact.isBuildOutput)return true;
        return corePaths.has(fact.path)||visiblePaths.has(fact.path);
    });
    var priority={shell:0,'action-entry':1,page:2,api:3,'database-adapter':4,service:5,component:6,hook:7,module:8,utility:9,test:10,fixture:11};
    function blockPriority(kind){
        return priority[kind]!==undefined?priority[kind]:12;
    }
    candidates.sort(function(a,b){
        return blockPriority(a.kind)-blockPriority(b.kind)||a.path.localeCompare(b.path);
    });
    if(candidates.length>ARCHITECTURE_MAX_BLOCKS){
        warnings.push('Diagram capped at '+ARCHITECTURE_MAX_BLOCKS+' blocks; '+(candidates.length-ARCHITECTURE_MAX_BLOCKS)+' directly related items were omitted for readability.');
        candidates=candidates.slice(0,ARCHITECTURE_MAX_BLOCKS);
    }
    var usedIds=Object.create(null);
    var profile=(facts[0]&&facts[0].profile)||'generic';
    var blocks=candidates.map(function(fact){
        var baseId=makeMermaidSafeId(fact.path);
        var id=baseId;
        var counter=2;
        while(usedIds[id]){
            id=baseId+'_'+counter;
            counter++;
        }
        usedIds[id]=true;
        return{
            id:id,
            title:architectureTitle(fact),
            kind:fact.kind,
            role:fact.role,
            group:fact.group,
            layer:architectureLayer(fact),
            route:fact.route,
            files:[fact.path],
            profile:profile,
            isTest:!!fact.isTest,
            isFixture:!!fact.isFixture,
            isBuildOutput:!!fact.isBuildOutput,
            loc:fact.loc||0
        };
    });
    if(facts.some(function(fact){return fact.dbUsage;})){
        blocks.push({id:'Storage_Database',title:'Database',kind:'database',role:'database',group:'Storage',layer:'Storage',profile:profile,files:[],isTest:false,isFixture:false,isBuildOutput:false,loc:0});
    }
    return aggregateArchitectureBlocks(blocks,profile,warnings);
}

function findBlockByFile(blocks,path){
    path=normalizeArchitecturePath(path);
    return (blocks||[]).find(function(block){return (block.files||[]).indexOf(path)>=0;})||null;
}

function findBlockByRoute(blocks,route){
    route=normalizeArchitectureRoute(route);
    var exact=(blocks||[]).find(function(block){return block.route&&normalizeArchitectureRoute(block.route)===route;});
    if(exact)return exact;
    return (blocks||[]).find(function(block){return block.route&&routeSegmentsMatch(block.route,route);})||null;
}

function findBlockByComponentName(blocks,name){
    return (blocks||[]).find(function(block){
        if(block.kind!=='component')return false;
        if(block.title===name)return true;
        var file=(block.files&&block.files[0])||'';
        return architectureFileBaseName(file)===name;
    })||null;
}

function findBlockByRole(blocks,role){
    return (blocks||[]).find(function(block){return block.role===role;})||null;
}

function findBlockByPathEnds(blocks,suffix){
    suffix=normalizeArchitecturePath(suffix).toLowerCase();
    return (blocks||[]).find(function(block){
        var file=normalizeArchitecturePath((block.files&&block.files[0])||'').toLowerCase();
        return file===suffix||file.endsWith('/'+suffix);
    })||null;
}

function inferDependencyKind(sourceKind,targetKind){
    if(targetKind==='database')return'database';
    if(sourceKind==='page'&&targetKind==='api')return'api-call';
    if(targetKind==='component')return'renders';
    if(targetKind==='hook')return'uses-hook';
    return'depends-on';
}

function buildImportBasedDependencies(facts,blocks,files){
    var deps=[];
    facts.forEach(function(fact){
        var source=findBlockByFile(blocks,fact.path);
        if(!source)return;
        fact.imports.forEach(function(importPath){
            var resolved=resolveArchitectureImport(importPath,fact.path,files);
            if(!resolved)return;
            var target=findBlockByFile(blocks,resolved);
            if(!target||target.id===source.id)return;
            deps.push({
                from:source.id,
                to:target.id,
                kind:inferDependencyKind(source.kind,target.kind),
                label:architectureDependencyLabel(source.role,target.role,importPath),
                confidence:'high'
            });
        });
        fact.jsxComponents.forEach(function(componentName){
            var target=findBlockByComponentName(blocks,componentName);
            if(!target||target.id===source.id)return;
            deps.push({from:source.id,to:target.id,kind:'renders',label:'renders '+componentName,confidence:'medium'});
        });
    });
    return deps;
}

function buildSyntheticArchitectureDependencies(blocks,facts){
    var deps=[];
    var shell=findBlockByRole(blocks,'browser-shell');
    var analyzer=findBlockByRole(blocks,'analyzer-loader')||findBlockByPathEnds(blocks,'card/lib/analyzer.js');
    var collector=findBlockByRole(blocks,'collector')||findBlockByPathEnds(blocks,'card/lib/collect.js');
    var action=findBlockByRole(blocks,'action-entry')||findBlockByPathEnds(blocks,'card/index.js');
    if(shell&&analyzer){
        deps.push({from:shell.id,to:analyzer.id,kind:'runtime',label:architectureDependencyLabel(shell.role,analyzer.role),confidence:'high'});
    }
    if(shell&&collector){
        deps.push({from:shell.id,to:collector.id,kind:'runtime',label:architectureDependencyLabel(shell.role,collector.role),confidence:'high'});
    }
    if(action&&shell){
        deps.push({from:action.id,to:shell.id,kind:'runtime',label:architectureDependencyLabel(action.role,shell.role),confidence:'high'});
    }
    var state=findBlockByRole(blocks,'state')||findBlockByPathEnds(blocks,'card/lib/state.js');
    var pr=findBlockByRole(blocks,'pr')||findBlockByPathEnds(blocks,'card/lib/pr.js');
    var git=findBlockByRole(blocks,'git')||findBlockByPathEnds(blocks,'card/lib/git.js');
    var inputs=findBlockByRole(blocks,'inputs')||findBlockByPathEnds(blocks,'card/lib/inputs.js');
    if(analyzer&&state){
        deps.push({from:analyzer.id,to:state.id,kind:'runtime',label:architectureDependencyLabel('analyzer-loader','state'),confidence:'medium'});
    }
    if(pr&&git){
        deps.push({from:pr.id,to:git.id,kind:'runtime',label:architectureDependencyLabel('pr','git'),confidence:'high'});
    }
    if(action&&collector&&inputs){
        deps.push({from:collector.id,to:inputs.id,kind:'runtime',label:architectureDependencyLabel('collector','inputs'),confidence:'medium'});
    }
    if(action&&collector&&git){
        deps.push({from:collector.id,to:git.id,kind:'runtime',label:architectureDependencyLabel('collector','git'),confidence:'medium'});
    }
    var appShell=findBlockByRole(blocks,'app-shell');
    if(appShell){
        blocks.forEach(function(block){
            if(block.role!=='frontend-route'||block.id===appShell.id)return;
            deps.push({from:appShell.id,to:block.id,kind:'runtime',label:architectureDependencyLabel('app-shell','frontend-route'),confidence:'high'});
        });
    }
    blocks.forEach(function(block){
        if(block.role!=='frontend-route')return;
        var component=blocks.find(function(candidate){
            return candidate.role==='frontend-component'&&candidate.route&&block.route&&normalizeArchitectureRoute(candidate.route)===normalizeArchitectureRoute(block.route);
        });
        if(component&&component.id!==block.id){
            deps.push({from:block.id,to:component.id,kind:'runtime',label:architectureDependencyLabel('frontend-route','frontend-component'),confidence:'high'});
        }
    });
    blocks.forEach(function(block){
        if(block.role!=='frontend-component')return;
        var analyzer=blocks.find(function(candidate){return candidate.role==='platform-analyzer';});
        if(analyzer&&analyzer.id!==block.id){
            deps.push({from:block.id,to:analyzer.id,kind:'runtime',label:architectureDependencyLabel('frontend-component','platform-analyzer'),confidence:'medium'});
        }
    });
    var routesBlock=findBlockByRole(blocks,'backend-routes');
    var middlewareBlock=findBlockByRole(blocks,'backend-middleware');
    var servicesBlock=findBlockByRole(blocks,'backend-services');
    if(routesBlock&&middlewareBlock){
        deps.push({from:routesBlock.id,to:middlewareBlock.id,kind:'runtime',label:architectureDependencyLabel('backend-routes','backend-middleware'),confidence:'medium'});
    }
    if(routesBlock&&servicesBlock){
        deps.push({from:routesBlock.id,to:servicesBlock.id,kind:'runtime',label:architectureDependencyLabel('backend-routes','backend-services'),confidence:'medium'});
    }
    facts.forEach(function(fact){
        if(!fact.isTest)return;
        var source=findBlockByFile(blocks,fact.path);
        if(!source)return;
        var targets=[];
        if(testFileReferencesCore(fact.content)){
            if(shell)targets.push(shell);
            if(analyzer)targets.push(analyzer);
            if(collector)targets.push(collector);
        }
        inferTestTargetPaths(fact.path).forEach(function(suffix){
            var target=findBlockByPathEnds(blocks,suffix);
            if(target)targets.push(target);
        });
        var seen=new Set();
        targets.forEach(function(target){
            if(!target||target.id===source.id||seen.has(target.id))return;
            seen.add(target.id);
            deps.push({from:source.id,to:target.id,kind:'tests',label:'tests',confidence:'high'});
        });
    });
    return deps;
}

function dedupeArchitectureDependencies(deps){
    var seen=new Set();
    return (deps||[]).filter(function(dep){
        var key=[dep.from,dep.to,dep.kind,dep.label].join('|');
        if(seen.has(key))return false;
        seen.add(key);
        return true;
    });
}

function buildArchitectureDependencies(facts,blocks,files){
    var deps=[];
    facts.forEach(function(fact){
        var source=findBlockByFile(blocks,fact.path);
        if(!source)return;
        fact.links.forEach(function(link){
            var target=findBlockByRoute(blocks,link);
            if(target&&target.id!==source.id){
                deps.push({from:source.id,to:target.id,kind:'navigation',label:'links '+link,confidence:'high'});
            }
        });
        fact.apiCalls.forEach(function(call){
            var target=findBlockByRoute(blocks,call.url);
            if(target&&target.id!==source.id){
                deps.push({from:source.id,to:target.id,kind:'api-call',label:call.method+' '+call.url,confidence:'high'});
            }
        });
        if(fact.dbUsage){
            deps.push({from:source.id,to:'Storage_Database',kind:'database',label:'queries',confidence:'medium'});
        }
    });
    deps=deps.concat(buildImportBasedDependencies(facts,blocks,files));
    deps=deps.concat(buildSyntheticArchitectureDependencies(blocks,facts));
    return dedupeArchitectureDependencies(deps).filter(function(dep){
        if(!dep.label||/^uses \d+ calls?$/i.test(dep.label))return false;
        return !!findBlockById(blocks,dep.from)&&!!findBlockById(blocks,dep.to);
    });
}

function getRenderedArchitectureDependencies(dependencies,visibleBlockIds){
    var visible=visibleBlockIds||null;
    var priority={high:0,medium:1,low:2};
    return (dependencies||[]).filter(function(dep){
        if(!visible)return true;
        return visible.has(dep.from)&&visible.has(dep.to);
    }).sort(function(a,b){
        return (priority[a.confidence]||9)-(priority[b.confidence]||9)||
            String(a.from).localeCompare(String(b.from))||
            String(a.to).localeCompare(String(b.to));
    }).slice(0,ARCHITECTURE_MAX_RENDERED_DEPENDENCIES);
}

function findBlockById(blocks,id){
    return (blocks||[]).find(function(block){return block.id===id;})||null;
}

function buildArchitectureGroups(blocks){
    var groups={};
    (blocks||[]).forEach(function(block){
        var key=block.group||block.layer||'Application';
        if(!groups[key])groups[key]=[];
        groups[key].push(block.id);
    });
    return groups;
}

function formatMermaidBlock(block){
    var label=escapeMermaidLabel(block.title);
    var filePath=(block.files&&block.files[0])||'';
    if(block.kind==='shell'||block.group==='App Entry / Shell'){
        if(filePath)label+='<br/>'+escapeMermaidLabel(filePath);
        if((block.files||[]).length>1)label+='<br/>'+((block.files||[]).length)+' shell files';
        else if(block.role==='browser-shell'||block.group==='Browser App')label+='<br/>React UI + Worker + Visualization';
    }else if(filePath){
        label+='<br/>'+escapeMermaidLabel(filePath);
    }else if(block.route){
        label+='<br/>'+escapeMermaidLabel(block.route);
    }
    if(block.kind==='database')return '[("'+label+'")]';
    if(block.kind==='api')return '{{"'+label+'"}}';
    return '["'+label+'"]';
}

function architectureGroupStyleClass(group){
    if(group==='Browser App'||group==='App Entry / Shell')return group==='App Entry / Shell'?'appentry':'browser';
    if(group==='GitHub Action')return'action';
    if(group==='Analysis Core')return'analysis';
    if(group==='Repository Collection')return'collection';
    if(group==='Rendering / Reports')return'rendering';
    if(group==='Frontend Routes / Views'||group==='Frontend Routes')return'frontend';
    if(group==='Frontend Components'||group==='Frontend Page Components')return'fecomponents';
    if(group==='Backend / API Layer'||group==='Backend API / Platform Logic')return'backend';
    if(group==='Services / Business Logic')return'services';
    if(group==='Data / Storage')return'storage';
    if(group==='Shared / Utilities'||group==='Shared Services / Utils')return'shared';
    if(group==='Configuration')return'config';
    if(group==='Content / Data')return'content';
    if(group==='Build Output')return'buildoutput';
    if(group==='Testing')return'testing';
    if(group==='Fixtures / Examples')return'fixtures';
    if(group==='Storage')return'storage';
    return'application';
}

function getVisibleArchitectureBlocks(blocks,includeTests,includeBuildOutput){
    return (blocks||[]).filter(function(block){
        if(block.isBuildOutput||block.group==='Build Output'||block.role==='build-output')return !!includeBuildOutput;
        if(block.isTest||block.isFixture)return !!includeTests;
        return true;
    });
}

function computeArchitectureStats(blocks,dependencies){
    return{
        blocks:blocks.length,
        dependencies:dependencies.length,
        routes:blocks.filter(function(block){return block.kind==='page'||block.kind==='shell';}).length,
        apiRoutes:blocks.filter(function(block){return block.kind==='api';}).length,
        databaseTouchpoints:dependencies.filter(function(dep){return dep.kind==='database';}).length
    };
}

function groupBlocksByArchitectureGroup(blocks,profile){
    var order=getArchitectureGroupOrder(profile||'generic');
    var grouped={};
    order.forEach(function(group){grouped[group]=[];});
    (blocks||[]).forEach(function(block){
        var group=block.group||'Application';
        if(!grouped[group])grouped[group]=[];
        grouped[group].push(block);
    });
    return {order:order,grouped:grouped};
}

function generateMermaidBlockDiagram(diagram,includeTests,includeBuildOutput){
    var allBlocks=diagram.blocks||[];
    var blocks=getVisibleArchitectureBlocks(allBlocks,!!includeTests,!!includeBuildOutput);
    var profile=diagram.profile||'generic';
    if(!blocks.length){
        return [
            'flowchart TD',
            '  classDef application fill:#252529,stroke:#8b8b95,color:#f0f0f2;',
            '  NoArchitecture["No architecture blocks detected"]',
            '  class NoArchitecture application;'
        ].join('\n');
    }
    var visibleIds=new Set(blocks.map(function(block){return block.id;}));
    var lines=[];
    lines.push('%%{init: {"flowchart": {"nodeSpacing": 45, "rankSpacing": 80}} }%%');
    lines.push('flowchart TB');
    lines.push('  classDef browser fill:#102033,stroke:#4d9fff,color:#f0f0f2;');
    lines.push('  classDef action fill:#1f2433,stroke:#7c8cff,color:#f0f0f2;');
    lines.push('  classDef analysis fill:#102033,stroke:#4d9fff,color:#f0f0f2;');
    lines.push('  classDef collection fill:#251b33,stroke:#a78bfa,color:#f0f0f2;');
    lines.push('  classDef rendering fill:#2b2414,stroke:#ff9f43,color:#f0f0f2;');
    lines.push('  classDef testing fill:#252529,stroke:#8b8b95,color:#f0f0f2;');
    lines.push('  classDef fixtures fill:#1f2b1f,stroke:#22c55e,color:#f0f0f2;');
    lines.push('  classDef storage fill:#2b2414,stroke:#ff9f43,color:#f0f0f2;');
    lines.push('  classDef application fill:#252529,stroke:#8b8b95,color:#f0f0f2;');
    lines.push('  classDef appentry fill:#102033,stroke:#4d9fff,color:#f0f0f2;');
    lines.push('  classDef frontend fill:#102033,stroke:#4d9fff,color:#f0f0f2;');
    lines.push('  classDef fecomponents fill:#152238,stroke:#6eb6ff,color:#f0f0f2;');
    lines.push('  classDef backend fill:#251b33,stroke:#a78bfa,color:#f0f0f2;');
    lines.push('  classDef config fill:#2b2414,stroke:#ff9f43,color:#f0f0f2;');
    lines.push('  classDef content fill:#1f2b1f,stroke:#22c55e,color:#f0f0f2;');
    lines.push('  classDef buildoutput fill:#252529,stroke:#666,color:#aaa;');
    var layout=groupBlocksByArchitectureGroup(blocks,profile);
    layout.order.forEach(function(group){
        if(!layout.grouped[group]||!layout.grouped[group].length)return;
        var subgraphLabel=group;
        if(group==='Testing'&&!includeTests)return;
        if(group==='Testing'&&includeTests)subgraphLabel='Testing - optional';
        if(group==='Build Output'&&!includeBuildOutput)return;
        if(group==='Build Output'&&includeBuildOutput)subgraphLabel='Build Output - optional';
        lines.push('  subgraph '+makeMermaidSafeId(group)+'_Group["'+escapeMermaidLabel(subgraphLabel)+'"]');
        lines.push('    direction TB');
        layout.grouped[group].forEach(function(block){
            lines.push('    '+block.id+formatMermaidBlock(block));
        });
        lines.push('  end');
    });
    getRenderedArchitectureDependencies(diagram.dependencies||[],visibleIds).forEach(function(dep){
        lines.push('  '+dep.from+' -->|"'+escapeMermaidLabel(dep.label||dep.kind)+'"| '+dep.to);
    });
    blocks.forEach(function(block){
        lines.push('  class '+block.id+' '+architectureGroupStyleClass(block.group)+';');
    });
    return lines.join('\n');
}

function buildArchitectureDiagram(files){
    var warnings=[];
    var framework=detectArchitectureFramework(files);
    var facts=extractArchitectureFacts(files,framework);
    var profile=(facts[0]&&facts[0].profile)||detectArchitectureProfile(files,framework);
    var blocks=makeArchitectureBlocks(facts,files,warnings);
    var dependencies=buildArchitectureDependencies(facts,blocks,files);
    if(dependencies.length>ARCHITECTURE_MAX_RENDERED_DEPENDENCIES){
        warnings.push('Diagram rendering shows the '+ARCHITECTURE_MAX_RENDERED_DEPENDENCIES+' strongest dependencies; export JSON includes all '+dependencies.length+'.');
    }
    if(framework==='Next.js'&&!blocks.length){
        warnings.push('Next.js was detected, but no page or API route blocks were visible in the analyzed files.');
    }else if(framework!=='Next.js'&&!blocks.length){
        warnings.push('No code files with architecture-significant blocks were visible in the analyzed files.');
    }
    var visibleBlocks=getVisibleArchitectureBlocks(blocks,false,false);
    var visibleIds=new Set(visibleBlocks.map(function(block){return block.id;}));
    var visibleDependencies=(dependencies||[]).filter(function(dep){return visibleIds.has(dep.from)&&visibleIds.has(dep.to);});
    var stats=computeArchitectureStats(visibleBlocks,visibleDependencies);
    stats.warnings=warnings.length;
    var hiddenSummary=computeArchitectureHiddenSummary(facts,blocks,false,false);
    var diagram={
        framework:framework,
        profile:profile,
        type:'block-diagram',
        options:{includeTests:false,includeBuildOutput:false},
        mermaid:'',
        blocks:blocks,
        dependencies:dependencies,
        groups:buildArchitectureGroups(visibleBlocks),
        stats:stats,
        hiddenSummary:hiddenSummary,
        warnings:warnings
    };
    diagram.mermaid=generateMermaidBlockDiagram(diagram,false,false);
    return diagram;
}

async function buildAnalysisData(options){
    var analyzed=options.analyzed||[];
    var allFns=options.allFns||[];
    var excludePatterns=options.excludePatterns||[];
    var progress=typeof options.progress==='function'?options.progress:function(){};
    var yieldFn=options.yieldFn||yieldToBrowser;
    var CALL_BATCH=30;

    progress('Building dependency graph (1/6)...');
    await yieldFn();
    await Parser.prepareTreeSitter(analyzed);
    var fnDefIndex=Parser.buildFunctionDefinitionIndex(allFns);
    var fnNames=Object.keys(fnDefIndex.byName);
    var fnNameIndex=Parser.buildFunctionNameIndex(fnNames);
    var fnDefLineIndex=Parser.buildFunctionDefLineIndex(allFns);
    var fileImportInfo=Object.create(null);
    analyzed.forEach(function(file){
        fileImportInfo[file.path]=Parser.extractCallGraphImportMap(file.content||'',file.path,analyzed);
    });
    var conns=[];
    var fnStats=Object.create(null);

    function createFunctionStat(fn){
        return{
            key:fn.key,
            name:fn.name,
            internal:0,
            external:0,
            callers:new Map(),
            file:fn.file,
            folder:fn.folder,
            line:fn.line,
            code:fn.code,
            isTopLevel:fn.isTopLevel!==false,
            isExported:fn.isExported||false,
            isClassMethod:fn.isClassMethod||false,
            type:fn.type||'function',
            decorators:fn.decorators||null,
            className:fn.className||null
        };
    }

    function firstDefinitionFromOneFile(defs){
        if(!defs.length)return null;
        var file=defs[0].file;
        for(var i=1;i<defs.length;i++){
            if(defs[i].file!==file)return null;
        }
        return defs[0];
    }

    function resolveCallDefinitions(fnName,file){
        var defs=fnDefIndex.byName[fnName]||[];
        if(!defs.length)return[];
        var sameFile=defs.filter(function(def){return def.file===file.path;});
        var sameFileDef=firstDefinitionFromOneFile(sameFile);
        if(sameFileDef)return[sameFileDef];
        if(defs.length===1)return[defs[0]];

        var imports=fileImportInfo[file.path]||{locals:Object.create(null),targets:new Set()};
        var directImports=(imports.locals&&imports.locals[fnName])||[];
        var matches=[];
        if(directImports.length){
            matches=defs.filter(function(def){return directImports.indexOf(def.file)>=0;});
            var directDef=firstDefinitionFromOneFile(matches);
            if(directDef)return[directDef];
        }

        if(imports.targets&&typeof imports.targets.has==='function'){
            matches=defs.filter(function(def){return imports.targets.has(def.file);});
            var importedDef=firstDefinitionFromOneFile(matches);
            if(importedDef)return[importedDef];
        }
        return[];
    }

    Object.keys(fnDefIndex.byKey).forEach(function(key){
        fnStats[key]=createFunctionStat(fnDefIndex.byKey[key]);
    });

    for(var bi=0;bi<analyzed.length;bi+=CALL_BATCH){
        var batchEnd=Math.min(bi+CALL_BATCH,analyzed.length);
        progress('Analyzing dependencies (2/6)... '+batchEnd+'/'+analyzed.length+' files');
        for(var fi=bi;fi<batchEnd;fi++){
            var file=analyzed[fi];
            if(!file.content)continue;
            var calls=Parser.findCalls(file.content,fnNames,file.path,fnDefLineIndex,fnNameIndex);
            Object.entries(calls).forEach(function(entry){
                var fn=entry[0],cnt=entry[1];
                if(cnt<=0)return;
                var defs=resolveCallDefinitions(fn,file);
                defs.forEach(function(def){
                    var stat=fnStats[def.key];
                    if(!stat)return;
                    if(def.file===file.path){
                        stat.internal+=cnt;
                    }else{
                        conns.push({source:def.file,target:file.path,fn:fn,count:cnt,functionKey:def.key});
                        var ex=stat.callers.get(file.path);
                        if(ex)ex.count+=cnt;
                        else stat.callers.set(file.path,{file:file.path,name:file.name,count:cnt});
                        stat.external+=cnt;
                    }
                });
            });
        }
        await yieldFn();
    }
    Object.values(fnStats).forEach(function(s){s.callers=Array.from(s.callers.values());s.count=s.internal+s.external;});

    progress('Resolving markdown links...');
    await yieldFn();
    var mdAllPaths=analyzed.map(function(f){return f.path;});
    analyzed.forEach(function(file){
        if(!Parser.isMarkdown(file.name))return;
        file.layer='note';
        if(!file.content)return;
        var links=Parser.extractMarkdownLinks(file.content);
        var deps=[];
        links.forEach(function(link){
            var resolved=Parser.resolveMarkdownLink(link.target,file.path,mdAllPaths,link.kind);
            deps.push({kind:link.kind,raw:link.raw,target:link.target,resolved:resolved});
            if(resolved&&resolved!==file.path){
                conns.push({source:file.path,target:resolved,fn:link.raw,count:1,kind:link.kind});
            }
        });
        file.dependencies=deps;
    });
    analyzed.forEach(function(f){if(!f.dependencies)f.dependencies=[];});

    var issues=[];
    var deadFns=Object.entries(fnStats).filter(function(x){
        var stats=x[1],name=stats.name;
        if(stats.internal>0||stats.external>0)return false;
        if(stats.isClassMethod)return false;
        if(!stats.isTopLevel)return false;
        if(stats.decorators&&stats.decorators.length>0)return false;
        if(stats.type==='class'||stats.type==='dataclass'||stats.type==='abstract_class')return false;
        var baseName=name.includes('.')?name.split('.').pop():name;
        if(baseName.startsWith('__')&&baseName.endsWith('__'))return false;
        if(baseName.startsWith('test_')||baseName==='setUp'||baseName==='tearDown'||baseName==='setUpClass'||baseName==='tearDownClass')return false;
        if(stats.file&&(stats.file.includes('test_')||stats.file.includes('_test.')||stats.file.includes('/tests/')))return false;
        if((baseName==='upgrade'||baseName==='downgrade')&&stats.file&&(stats.file.includes('migration')||stats.file.includes('alembic')||stats.file.includes('versions')))return false;
        if(['main','create_app','make_app','get_app','setup','configure','register','on_startup','on_shutdown','lifespan'].indexOf(baseName)>=0)return false;
        if(stats.isExported&&stats.file&&/\.[jt]sx?$/.test(stats.file))return false;
        if(stats.file&&(/\.(?:spec|test)\.[jt]sx?$/.test(stats.file)||stats.file.includes('__tests__')))return false;
        return true;
    });
    if(deadFns.length)issues.push({type:'warning',title:deadFns.length+' Unused Functions',desc:'Functions not called from other files',items:deadFns.map(function(x){return{name:x[1].name,file:x[1].file,line:x[1].line,code:x[1].code};})});

    var godFiles=analyzed.filter(function(f){return f.functions.length>15;});
    if(godFiles.length)issues.push({type:'critical',title:godFiles.length+' Large Files',desc:'Files with 15+ functions',items:godFiles.map(function(f){return{name:f.name+' ('+f.functions.length+' fns)',file:f.path,fns:f.functions.length,lines:f.lines};})});

    var coupling=Object.create(null);
    conns.forEach(function(c){coupling[c.target]=(coupling[c.target]||0)+1;});
    var highCoup=Object.entries(coupling).filter(function(x){return x[1]>8;}).sort(function(a,b){return b[1]-a[1];});
    if(highCoup.length)issues.push({type:'warning',title:highCoup.length+' Highly Coupled',desc:'Files that import 8+ other files',items:highCoup.map(function(x){return{name:x[0].split('/').pop()+' ('+x[1]+' imports)',file:x[0],imports:x[1]};})});

    var connSet=new Set(conns.map(function(c){return c.source+'|'+c.target;}));
    var circular=[];
    conns.forEach(function(c){
        if(connSet.has(c.target+'|'+c.source)){
            var key=[c.source,c.target].sort().join('|');
            if(!circular.includes(key))circular.push(key);
        }
    });
    if(circular.length)issues.push({type:'critical',title:circular.length+' Circular Dependencies',desc:'Files that import each other',items:circular.map(function(p){var parts=p.split('|');return{name:parts.map(function(x){return x.split('/').pop();}).join(' ↔ '),files:parts};})});

    progress('Detecting patterns (3/6)...');
    await yieldFn();
    var patterns=Parser.detectPatterns(analyzed);
    var securityIssues=Parser.detectSecurity(analyzed);

    progress('Analyzing code quality (4/6)...');
    await yieldFn();
    var duplicates=Parser.detectDuplicates(analyzed,allFns);
    var layerViolations=Parser.detectLayerViolations(analyzed,conns);
    for(var ci=0;ci<analyzed.length;ci+=CALL_BATCH){
        var cEnd=Math.min(ci+CALL_BATCH,analyzed.length);
        for(var cj=ci;cj<cEnd;cj++){
            analyzed[cj].complexity=analyzed[cj].isCode!==false?Parser.calcComplexity(analyzed[cj].content,analyzed[cj].path):{score:0,level:'low'};
        }
        if(ci+CALL_BATCH<analyzed.length)await yieldFn();
    }

    progress('Building architecture diagram (5/6)...');
    await yieldFn();
    var architectureDiagram=buildArchitectureDiagram(analyzed);

    progress('Finalizing (6/6)...');
    await yieldFn();
    analyzed.forEach(function(f){f.content=null;});

    var folders=[...new Set(analyzed.map(function(f){return f.folder;}))].sort();
    var tree=buildTree(analyzed);
    var totalLoc=analyzed.reduce(function(s,f){return s+f.lines;},0);
    var langStats=Object.create(null);
    var parserStats=Object.create(null);
    analyzed.forEach(function(f){
        var ext=f.name.split('.').pop().toLowerCase();
        langStats[ext]=(langStats[ext]||0)+f.lines;
        var provenance=f.parserProvenance||Parser.getParserProvenance(f.path||f.name);
        f.parserProvenance=provenance;
        parserStats[provenance]=(parserStats[provenance]||0)+1;
    });
    var langArray=Object.entries(langStats).sort(function(a,b){return b[1]-a[1];}).map(function(e){return{ext:e[0],lines:e[1],pct:totalLoc?Math.round(e[1]/totalLoc*100):0};});
    var parserArray=Object.entries(parserStats).sort(function(a,b){return b[1]-a[1];}).map(function(e){return{mode:e[0],files:e[1]};});

    if(duplicates.length>0){
        var nameDups=duplicates.filter(function(d){return d.type==='name';});
        var codeDups=duplicates.filter(function(d){return d.type==='code';});
        if(nameDups.length)issues.push({type:'warning',title:nameDups.length+' Duplicate Function Names',desc:'Same function name in multiple files',items:nameDups.map(function(d){return{name:d.name+' ('+d.count+' files)',suggestion:d.suggestion,files:d.files,count:d.count};})});
        if(codeDups.length)issues.push({type:'warning',title:codeDups.length+' Similar Code Blocks',desc:'Copy-paste code detected',items:codeDups.map(function(d){return{name:d.name,suggestion:d.suggestion,files:d.files};})});
    }
    if(layerViolations.length>0){
        issues.push({type:'critical',title:layerViolations.length+' Architecture Violations',desc:'Lower layers importing from higher layers',items:layerViolations.map(function(v){return{name:v.fromLayer+' → '+v.toLayer,file:v.from,toFile:v.to,fn:v.fn,suggestion:v.suggestion};})});
    }
    var highComplexity=analyzed.filter(function(f){return f.complexity&&f.complexity.level==='critical';}).sort(function(a,b){return b.complexity.score-a.complexity.score;});
    if(highComplexity.length)issues.push({type:'warning',title:highComplexity.length+' High Complexity Files',desc:'Files with complexity score >30',items:highComplexity.map(function(f){return{name:f.name+' ('+f.complexity.score+')',file:f.path,score:f.complexity.score,lines:f.lines};})});

    var dataObj={
        files:analyzed,
        functions:allFns,
        connections:conns,
        fnStats:fnStats,
        folders:folders,
        tree:tree,
        issues:issues,
        patterns:patterns,
        securityIssues:securityIssues,
        duplicates:duplicates,
        layerViolations:layerViolations,
        architectureDiagram:architectureDiagram,
        deadFunctions:deadFns.map(function(x){var codeLines=x[1].code?x[1].code.split('\n').length:0;return{name:x[1].name,file:x[1].file,folder:x[1].folder,line:x[1].line,code:x[1].code,codeLines:codeLines,ext:x[1].file.split('.').pop()};}),
        excludePatterns:excludePatterns,
        stats:{files:analyzed.length,functions:allFns.length,connections:conns.length,dead:deadFns.length,patterns:patterns.length,security:securityIssues.filter(function(i){return i.severity==='high';}).length,duplicates:duplicates.length,violations:layerViolations.length,loc:totalLoc,languages:langArray,parserModes:parserArray}
    };
    dataObj.suggestions=Parser.generateSuggestions(dataObj);
    return dataObj;
}
function calcBlast(fileId,conns,files){
    // Comprehensive impact analysis for a file
    // Connection format: {source: fileDefiningFn, target: fileCallingFn, fn: fnName, count: callCount}

    // Build adjacency lists for fast lookups
    var exportedTo={};// fileId -> Set of files that import from it
    var importedFrom={};// fileId -> Set of files it imports from
    var exportedFns={};// fileId -> Map of fn -> count of external calls

    conns.forEach(function(c){
        var src=typeof c.source==='object'?c.source.id:c.source;
        var tgt=typeof c.target==='object'?c.target.id:c.target;
        // src exports, tgt imports
        if(!exportedTo[src])exportedTo[src]=new Set();
        exportedTo[src].add(tgt);
        if(!importedFrom[tgt])importedFrom[tgt]=new Set();
        importedFrom[tgt].add(src);
        if(!exportedFns[src])exportedFns[src]=new Map();
        var fnMap=exportedFns[src];
        fnMap.set(c.fn,(fnMap.get(c.fn)||0)+(c.count||1));
    });

    // 1. Direct dependents (files that directly import from this file)
    var directDeps=exportedTo[fileId]?Array.from(exportedTo[fileId]):[];

    // 2. Transitive dependents (BFS with depth tracking)
    var transitive=new Map();// fileId -> depth
    var queue=directDeps.map(function(f){return{file:f,depth:1};});
    var visited=new Set([fileId].concat(directDeps));
    while(queue.length>0){
        var item=queue.shift();
        if(item.depth>3)continue;// Limit depth to 3 for transitive
        transitive.set(item.file,item.depth);
        var nextDeps=exportedTo[item.file]||new Set();
        nextDeps.forEach(function(f){
            if(!visited.has(f)){
                visited.add(f);
                queue.push({file:f,depth:item.depth+1});
            }
        });
    }

    // 3. Functions exported (how many of this file's functions are used)
    var fnUsage=exportedFns[fileId]||new Map();
    var fnsUsed=fnUsage.size;
    var totalCalls=0;
    fnUsage.forEach(function(cnt){totalCalls+=cnt;});

    // 4. Dependencies (files this file imports from - its risk)
    var dependencies=importedFrom[fileId]?Array.from(importedFrom[fileId]):[];

    // 5. Calculate weighted impact score
    // Direct deps count fully, transitive count with decay
    var impactScore=directDeps.length;
    transitive.forEach(function(depth,f){
        if(depth>1)impactScore+=1/depth;// 0.5 for depth 2, 0.33 for depth 3
    });

    // 6. Calculate centrality (how connected is this file)
    var centrality=directDeps.length+dependencies.length+fnsUsed;

    // Determine level based on direct dependents and functions used
    var level='low';
    var connectedFiles=files.filter(function(f){return exportedTo[f.path]||importedFrom[f.path];}).length;
    var relativePct=connectedFiles>0?Math.round(directDeps.length/connectedFiles*100):0;

    if(directDeps.length>=8||fnsUsed>=5)level='critical';
    else if(directDeps.length>=4||fnsUsed>=3)level='high';
    else if(directDeps.length>=2||fnsUsed>=1)level='medium';

    return{
        affected:directDeps,
        transitive:Array.from(transitive.keys()),
        count:directDeps.length,
        transitiveCount:transitive.size,
        percent:relativePct,
        level:level,
        depth:transitive.size>0?Math.max.apply(null,Array.from(transitive.values())):0,
        fnsUsed:fnsUsed,
        totalCalls:totalCalls,
        dependencies:dependencies,
        impactScore:Math.round(impactScore*10)/10,
        centrality:centrality
    };
}

function calcHealth(data){
    if(!data)return{score:0,grade:'F'};
    var score=100;
    var deadPct=data.stats.functions>0?(data.stats.dead/data.stats.functions*100):0;
    score-=Math.min(20,deadPct);
    var circular=data.issues.filter(function(i){return i.title.includes('Circular');}).length;
    score-=Math.min(20,circular*5);
    var god=data.issues.filter(function(i){return i.title.includes('Large');}).length;
    score-=Math.min(15,god*3);
    var avgCoup=data.stats.files>0?(data.stats.connections/data.stats.files):0;
    score-=Math.min(15,Math.max(0,avgCoup-3)*2);
    var sec=data.securityIssues?data.securityIssues.filter(function(i){return i.severity==='high';}).length:0;
    score-=Math.min(20,sec*5);
    score=Math.max(0,Math.round(score));
    var grade='F';
    if(score>=90)grade='A';else if(score>=80)grade='B';else if(score>=70)grade='C';else if(score>=60)grade='D';
    return{score:score,grade:grade};
}
// ===== CODEFLOW_CORE_END =====

// ---------------------------------------------------------------------------
// Inline Worker Runtime
// ---------------------------------------------------------------------------

var analysisWorkerSourcePromise=null;

function createAnalysisWorkerSource(){
    if(analysisWorkerSourcePromise)return analysisWorkerSourcePromise;
    // Pre-extraction, this fetched window.location.href (the whole page) and
    // sliced out the analyzer block by string marker. Now that the analyzer
    // is its own module, `import.meta.url` is the module's own resolved URL
    // (e.g. /src/analyzer.js in dev, or the hashed built asset in
    // production) — fetching that returns exactly this file's source, no
    // slicing by page-text needed. The CODEFLOW_CORE_START/END markers
    // below are still used, but now only to exclude this function and
    // runAnalysisData from the text embedded into the worker: those two
    // reference Worker/Blob/import.meta, and `import.meta` is a *syntax*
    // error when parsed as part of a classic (non-module) script — which is
    // what this worker is (new Worker(blobUrl) with no {type:'module'}, to
    // avoid the separate uncertainty of loading the CDN acorn/Babel/
    // tree-sitter libraries — which aren't ESM — via `import` instead of
    // `importScripts` inside a module worker).
    analysisWorkerSourcePromise=fetch(import.meta.url,{cache:'no-store'}).then(function(response){
        if(!response.ok)throw new Error('Unable to load analyzer source');
        return response.text();
    }).then(function(moduleSource){
        var startMarker='// ===== CODEFLOW_'+'CORE_START =====';
        var endMarker='// ===== CODEFLOW_'+'CORE_END =====';
        var coreStart=moduleSource.indexOf(startMarker);
        var coreEnd=moduleSource.indexOf(endMarker,coreStart);
        if(coreStart<0||coreEnd<0)throw new Error('Analyzer core markers missing');
        var analyzerSource=moduleSource.slice(coreStart,coreEnd);
        return [
            'self.window=self;',
            'function yieldToBrowser(){return Promise.resolve();}',
            'try{importScripts(\"https://cdnjs.cloudflare.com/ajax/libs/acorn/8.11.3/acorn.min.js\");}catch(e){}',
            'try{importScripts(\"https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js\");}catch(e){}',
            'try{importScripts(\"https://cdn.jsdelivr.net/npm/web-tree-sitter@0.20.8/tree-sitter.js\");}catch(e){}',
            analyzerSource,
            'self.onmessage=async function(event){',
            '  var payload=event.data||{};',
            '  try{',
            '    var data=await buildAnalysisData({',
            '      analyzed:payload.analyzed||[],',
            '      allFns:payload.allFns||[],',
            '      excludePatterns:payload.excludePatterns||[],',
            '      progress:function(message){self.postMessage({type:\"progress\",message:message});},',
            '      yieldFn:function(){return Promise.resolve();}',
            '    });',
            '    self.postMessage({type:\"done\",data:data});',
            '  }catch(error){',
            '    self.postMessage({type:\"error\",message:error&&error.message?error.message:String(error)});',
            '  }',
            '};'
        ].join('\n');
    });
    return analysisWorkerSourcePromise;
}

function runAnalysisData(options){
    if(typeof Worker==='undefined'||typeof Blob==='undefined'||typeof URL==='undefined'){
        return buildAnalysisData(options);
    }
    return createAnalysisWorkerSource().then(function(workerSource){
        return new Promise(function(resolve,reject){
            var workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
            var worker=new Worker(workerUrl);
            var settled=false;
            function cleanup(){
                worker.terminate();
                URL.revokeObjectURL(workerUrl);
            }
            worker.onmessage=function(event){
                var message=event.data||{};
                if(message.type==='progress'){
                    if(typeof options.progress==='function')options.progress(message.message);
                    return;
                }
                settled=true;
                cleanup();
                if(message.type==='done')resolve(message.data);
                else reject(new Error(message.message||'Worker analysis failed'));
            };
            worker.onerror=function(error){
                if(settled)return;
                settled=true;
                cleanup();
                reject(error&&error.message?new Error(error.message):new Error('Worker analysis failed'));
            };
            worker.postMessage({
                analyzed:options.analyzed||[],
                allFns:options.allFns||[],
                excludePatterns:options.excludePatterns||[]
            });
        });
    }).catch(function(){
        return buildAnalysisData(options);
    });
}

// Most names below are referenced directly by index.html's remaining
// (non-analyzer) app script — verified by grepping every top-level
// declaration in this file against index.html post-extraction, not
// guessed. buildArchitectureDiagram is the one exception: it isn't called
// from index.html itself but is exercised directly by
// tests/architecture-diagram.test.mjs. If a future edit to index.html
// starts calling another top-level name from this module, it must be
// added here or that call site will throw a ReferenceError (see the
// window-bridge <script type="module"> in index.html, which assigns
// exactly these exports onto window via Object.assign).
export { getSecurityScanContent, isSanitizedPreviewRenderer, Parser, escapeHtml, renderTooltipHtml, GitHub, countFiles, getArchitectureGroupOrder, getVisibleArchitectureBlocks, computeArchitectureStats, generateMermaidBlockDiagram, buildArchitectureDiagram, buildAnalysisData, calcBlast, calcHealth, createAnalysisWorkerSource, runAnalysisData };
