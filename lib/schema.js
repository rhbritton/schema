var util = require('./util')
  , any = function Any() {}
  , Errors = require('common-errors')

var Schema = module.exports = function(definition, options) {
	this.definition = {}
	this.options = options || {}
	this.properties = {}
	this.add(definition)
}

Schema.name = 'Schema'
Schema.coercers = require('./coercers')
Schema.Types = { Any: any }

Schema.use = function(plugin, options) {
	plugin(Schema, options || {})
}

Schema.prototype.use = function(plugin, options) {
	plugin(this, options || {})
}

Schema.prototype.add = function(definition) {
	var schema = this
	Object.keys(definition).forEach(function(key) {
		schema.definition[key] = parseDefinition(definition[key], key)
		Object.keys(schema.definition[key]).forEach(function(prop) {
			schema.properties[prop] = schema.properties[prop] || {}
			schema.properties[prop][key] = schema.definition[key][prop]
		})
		if(schema.definition[key].schema) Object.keys(schema.definition[key].schema.properties).forEach(function(prop) {
			schema.properties[prop] = schema.properties[prop] || {}
			schema.properties[prop]['_'] = {}
			schema.properties[prop]['_'][key] = {}
			Object.keys(schema.definition[key].schema.properties[prop]).forEach(function(sub_key) {
				schema.properties[prop]['_'][key][sub_key] = schema.definition[key].schema.properties[prop][sub_key]
			})
		})
	})
}

Schema.prototype.extend = function(definition) {
	var new_schema = new Schema(this.definition, this.options)
	new_schema.add(definition)
	return new_schema
}

Schema.prototype.validate = function(object, strict_mode) {
	var schema = this
	  , error = new Errors.ValidationError()
	  , undefined
	  , field
	
	Object.keys(object).forEach(function(key) {
		try {
			schema.validateField(object, key, strict_mode)
		} catch(e) {
			error.addErrors(e.errors)
		}
	})

	this.applyDefaults(object)

	error.addErrors(this.requires(object))

	if(error.errors.length) throw error
	
	return true
}

Schema.prototype.requires = function(object) {
	var errors = []
	  , definition = this.definition

	this.recurseProperties('required', object, this.requires, handler, aggregator)

	function handler(object, key, required) {
		if(!util.isExistent(object[key]) && required)
			if(required instanceof Function)
				try { required(object, key, definition[key].name) } 
				catch(e) { errors.push(e) }
			else
				errors.push(new Errors.ValidationError(definition[key].name + ' is required.'))
	}

	function aggregator(object, key, result) {
		errors.push.apply(errors, result)
	}

	return errors
}

Schema.prototype.applyDefaults = function(object) {
	this.recurseProperties('default', object, this.applyDefaults, handler, aggregator)

	function handler(object, key, default_value) {
		if(!util.isExistent(object[key])) 
			object[key] = default_value
	}

	function aggregator(object, key, result) {
		object[key] = result
	}

	return object
}

Schema.prototype.recurseProperties = function(property, object, recurser, handler, aggregator) {
	var schema = this
	  , properties = this.properties
	  , property_keys = properties[property]

	if(!property_keys) return 
	
	this._recursing = true
	
	Object.keys(property_keys).forEach(function(key) {
		if(key != '_') handler.call(this, object, key, property_keys[key])
	})
	
	if(properties.schema && property_keys._) Object.keys(properties.schema).forEach(function(key) {
		var subschema = properties.schema[key]
		if(key != '_' && property_keys._[key] && !subschema._recursing)
			aggregator.call(this, object, key, recurser.call(subschema, {}))
	})

	delete this._recursing
}

Schema.prototype.validateField = function(object, key, strict_mode, definition) {
	var keys
	  , errors = new Errors.ValidationError()

	if(!definition) {
		keys = key.split('.')
		key = keys.splice(0,1)[0]
		keys = keys.join('.')
		definition = this.definition[key]
	}

	if(!definition)
		if(this.options.dynamic) return true
		else throw errors.addError(new Errors.ValidationError(key + ' is not in the schema.', '', key))	

	if(!util.isExistent(object[key]) && util.isExistent(definition.default))
		object[key] = definition.default

	try {
		if(definition.type != any)
			object[key] = coerceType(object[key], definition.type)
	} catch(e) {
		throw errors.addError(new Errors.ValidationError('Expected ' + definition.name + ' to be a ' + definition.type.name + '.', '', key))
	}

	if(definition.type == Array) for(var i = 0; i < object[key].length; i++) {
		var result = this.validateField(object[key], i, strict_mode, definition.items)
		if(!result.length) return result
	}

	if(definition.type == Object)
		if(keys) return definition.schema.validateField(object[key], keys, strict_mode)
		else return definition.schema.validate(object[key], strict_mode)

	try {
		if(definition.validators) definition.validators.forEach(function(validator) {
			var new_value = validator(object[key], object, key, definition.name)
			if(util.isExistent(new_value)) object[key] = new_value
		})
	} catch(e) {
		throw errors.addError(new Errors.ValidationError(e, '', key))
	}

	return true
}

Schema.schema = new Schema({
	name: String,
	type: [Function, Array],
	required: [Boolean, Function],
	validators: [Function]
})
Schema.schema.add({
	default: { type:Schema.Types.Any, validators:[function(val, obj, prop, name) {
		if(!util.typeMatch(val, obj.type)) {
			throw new Error(prop + ' is invalid. Default value must match type.' +  (obj.type.name ? ' ' + JSON.stringify(val) + ' is not a ' + obj.type.name : ''))
		}
	}] }
})
Schema.schema.add({
	schema: { type:Schema, required:function ifObject(obj, prop, name){
		if(obj.type == Object) throw new Error('Schema is required for objects')
		if(obj.type instanceof Array && object.type.indexOf(Object) == -1) throw new Error('Schema is required for objects')
	} },
	items: { type:Object, schema:Schema.schema, required:function ifArray(obj, prop, name){
		if(obj.type == Array) throw new Error('Items is required for arrays')
		if(obj.type instanceof Array && object.type.indexOf(Array) == -1) throw new Error('Items is required for arrays')
	} }
})
Schema.schema.options.dynamic = true

function parseDefinition(value, key) {
	var use

	if(util.isArray(value) && value.length == 1)
		value = { type:Array, items:value[0] }
	else if(util.isObject(value) && !value.type)
		value = { type:Object, schema:value }
	else if(!util.isObject(value))
		value = { type:value }

	if(!value.name)
		value.name = util.titleCase(key)

	if(value.schema && value.schema.constructor != Schema)
		try { value.schema = new Schema(value.schema) } 
		catch(e) { throw new Error(key+'.'+(e[0] || e).message) }

	if(value.items)
		try { value.items = parseDefinition(value.items, key+'[]') }
		catch(e) { throw new Error((e[0] || e).message) }

	while(value.use && value.use != use) {
		use = value.use
		use(value)
	}

	if(!util.isValidType(value.type))
		throw new Error(key + ' is invalid. Type must be a constructor function.')

	if(Schema.schema) {
		var result = Schema.schema.validate(value)
		if(result.length) throw result[0]
	}

	return value
}

function coerceType(instance, constructor) {
	if(util.typeMatch(instance, constructor)) return instance

	if(util.isArray(constructor)) {
		for(var i = 0; i < constructor.length; i++) {
			try{ return coerceType(instance, constructor[i]) }
			catch(e) { if(i+1 == constructor.length) throw e }
		}
	}

	if(Schema.coercers[constructor]) {
		return Schema.coercers[constructor](instance)
	} else if(util.typeMatch(instance, String) && constructor != Array && constructor != Object) {
		var coerced = new constructor(instance)
		if(util.isExistent(coerced)) return coerced
	}

	throw new Error('Could not coerce')
}