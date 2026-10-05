// server-call-fixtures.js — the s454 U1b slice tests' shared sources: the
// design's notes-editor worked program (bootstrap-u1b-client-server-call-design
// Item 1, Approach B), in the §66 dialect the bootstrap parses.

const SQ = "?" + "{";   // the sigil, built in two pieces (impl#1 rewrites a literal one in strings)

export const NOTES = `    type SaveError:enum = {
        Conflict(current: int)
        TooLong(limit: int)
        Storage
    }
    let <body:string=""/>
    let <version:int=0/>
    let <words:int=0/>
    let <status:string=""/>
    let <flag:boolean=false/>
    function saveNote(id: string, text: string, base: int)! SaveError {
        if (text.length > 10000) fail .TooLong(10000)
        ${SQ}\`UPDATE notes SET body = \${text} WHERE id = \${id}\`}.run() !{ _ :> { fail .Storage } }
        return base + 1
    }
    function wordCount(id: string) -> int {
        const row = ${SQ}\`SELECT body FROM notes WHERE id = \${id}\`}.get() !{ _ :> not }
        return 0
    }`;

export const SAVE = `    function save() {
        @version = saveNote("n1", @body, @version) !{
            .Conflict(cur) :> { @status = "edited elsewhere"; return }
            .TooLong(n)    :> { @status = "too long"; return }
            .Storage       :> { @status = "could not store"; return }
            .Transport(t)  :> { @status = "transport"; return }
        }
        @status = "saved"
    }`;

export const RECOUNT = `    function recount() {
        @words = wordCount("n1") !{ .Transport(t) :> @words }
    }`;
